(function(){
  "use strict";

  if(!window.supabase || !SUPABASE_CONFIG || SUPABASE_CONFIG.url.includes("SEU-PROJETO")){
    document.getElementById('login-hint').textContent =
      'Configure o arquivo config.js com a URL e a chave anon do seu projeto Supabase antes de usar.';
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  const FUNCTIONS_URL = SUPABASE_CONFIG.url.replace('.supabase.co', '.functions.supabase.co');

  let clients = [];
  let deletedClients = [];
  let monthlyFee = 60;
  let currentSession = null;
  let realtimeChannel = null;

  function formatBRL(n){
    return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  let toastTimer;
  function toast(msg, isError){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> el.classList.remove('show'), 3000);
  }

  function setSyncStatus(text, cls){
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.classList.remove('dirty', 'linked');
    if(cls) el.classList.add(cls);
  }

  // ---------------- Auth ----------------
  document.getElementById('login-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const email = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error || !data.session){
      errEl.textContent = error ? traduzErro(error.message) : 'E-mail ou senha inválidos.';
      errEl.style.display = 'block';
      return;
    }
    await enterApp(data.session);
  });

  document.getElementById('logout-btn').addEventListener('click', async function(){
    if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
    await sb.auth.signOut();
    currentSession = null;
    document.getElementById('login-password').value = '';
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });

  function traduzErro(msg){
    if(/invalid login credentials/i.test(msg)) return 'E-mail ou senha inválidos.';
    if(/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
    return msg;
  }

  async function enterApp(session){
    currentSession = session;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('current-user-label').textContent = session.user.email;
    setSyncStatus('🟢 Conectado ao Supabase', 'linked');

    await sb.rpc('process_monthly_billing');
    await loadBillingMeta();
    await loadClients();
    await loadUsers();
    subscribeRealtime();
  }

  function subscribeRealtime(){
    if(realtimeChannel) return;
    realtimeChannel = sb
      .channel('clients-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        loadClients();
        if(document.getElementById('panel-deleted').classList.contains('active')){
          loadDeletedClients();
        }
      })
      .subscribe();
  }

  // ---------------- Tabs ----------------
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function(){
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab === 'users') loadUsers();
      if(btn.dataset.tab === 'deleted') loadDeletedClients();
    });
  });

  // ---------------- Billing / mensalidade ----------------
  async function loadBillingMeta(){
    const { data, error } = await sb.from('billing_meta').select('monthly_fee').eq('id', true).single();
    if(!error && data){ monthlyFee = Number(data.monthly_fee); }
  }

  document.getElementById('edit-fee-btn').addEventListener('click', () => {
    document.getElementById('fee-input').value = monthlyFee;
    document.getElementById('fee-modal').classList.add('open');
  });
  document.getElementById('fee-modal-cancel').addEventListener('click', () => {
    document.getElementById('fee-modal').classList.remove('open');
  });
  document.getElementById('fee-modal-save').addEventListener('click', async () => {
    const newFee = parseFloat(document.getElementById('fee-input').value);
    if(isNaN(newFee) || newFee < 0){ toast('Informe um valor válido.', true); return; }
    const { error } = await sb.from('billing_meta').update({ monthly_fee: newFee }).eq('id', true);
    if(error){ toast('Erro ao atualizar mensalidade: ' + error.message, true); return; }
    monthlyFee = newFee;
    document.getElementById('fee-modal').classList.remove('open');
    toast('Valor da mensalidade atualizado.');
    renderClients();
  });

  // ---------------- Client form ----------------
  const clientFormCard = document.getElementById('client-form-card');
  document.getElementById('toggle-client-form').addEventListener('click', () => {
    clientFormCard.classList.toggle('open');
  });
  document.getElementById('cancel-client-form').addEventListener('click', () => {
    clientFormCard.classList.remove('open');
    document.getElementById('client-form').reset();
  });

  document.getElementById('client-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const installments = parseInt(document.getElementById('c-installments').value, 10) || 0;
    const payload = {
      name: document.getElementById('c-name').value.trim(),
      account: document.getElementById('c-account').value.trim(),
      password: document.getElementById('c-password').value,
      usage_password: document.getElementById('c-usage-password').value,
      phone: document.getElementById('c-phone').value.trim(),
      access_key: document.getElementById('c-key').value.trim(),
      installments_total: installments,
      installments_left: installments,
      notes: document.getElementById('c-notes').value.trim(),
      created_by: currentSession.user.id
    };
    const { error } = await sb.from('clients').insert(payload);
    if(error){ toast('Erro ao salvar cliente: ' + error.message, true); return; }
    this.reset();
    document.getElementById('c-installments').value = 12;
    clientFormCard.classList.remove('open');
    toast('Cliente cadastrado com sucesso.');
    await loadClients();
  });

  // ---------------- Load & render clients (ativos) ----------------
  async function loadClients(){
    const { data, error } = await sb.from('clients')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if(error){ toast('Erro ao carregar clientes: ' + error.message, true); return; }
    clients = data || [];
    renderClients();
  }

  async function loadDeletedClients(){
    const { data, error } = await sb.from('clients')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if(error){ toast('Erro ao carregar excluídos: ' + error.message, true); return; }
    deletedClients = data || [];
    renderDeletedClients();
  }

  function ringStyle(pctLeft){
    return 'background: conic-gradient(var(--accent) ' + (pctLeft*3.6) + 'deg, var(--border) ' + (pctLeft*3.6) + 'deg 360deg);';
  }

  function installmentsCellHtml(c){
    const pctLeft = c.installments_total > 0 ? Math.round((c.installments_left / c.installments_total) * 100) : 0;
    const done = c.installments_left <= 0;
    return done ?
      '<span class="badge-done">Quitado</span>' :
      '<div class="installments"><div class="ring" style="' + ringStyle(pctLeft) + '"><div class="ring-inner"></div></div>' +
      '<div class="count"><b>' + c.installments_left + '</b> <small>/ ' + c.installments_total + '</small></div></div>';
  }

  function baseRowCellsHtml(c){
    return '<td class="name" data-label="Nome">' + escapeHtml(c.name) + '</td>' +
      '<td class="mono" data-label="Conta iCloud">' + escapeHtml(c.account) + '</td>' +
      '<td data-label="Senha iCloud">' + secretCellHtml(c.password) + '</td>' +
      '<td data-label="Senha (tempo de uso)">' + secretCellHtml(c.usage_password) + '</td>' +
      '<td class="mono" data-label="Telefone">' + escapeHtml(c.phone) + '</td>' +
      '<td data-label="Chave de acesso">' + secretCellHtml(c.access_key) + '</td>' +
      '<td data-label="Parcelas">' + installmentsCellHtml(c) + '</td>';
  }

  function renderClients(){
    const tbody = document.getElementById('clients-tbody');
    const emptyEl = document.getElementById('clients-empty');
    tbody.innerHTML = '';
    emptyEl.style.display = clients.length === 0 ? 'block' : 'none';

    clients.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = baseRowCellsHtml(c) +
        '<td data-label="Ações"><div class="row-actions">' +
            '<button class="icon-btn" data-action="edit" title="Editar senhas">' + editIcon() + '</button>' +
            '<button class="icon-btn" data-action="notes" title="Notas">' + notesIcon() + '</button>' +
            '<button class="icon-btn danger" data-action="delete" title="Excluir">' + trashIcon() + '</button>' +
          '</div></td>';

      bindSecretToggles(tr);
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(c.id));
      tr.querySelector('[data-action="notes"]').addEventListener('click', () => openNotesModal(c.id, false));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteClient(c.id, c.name));

      tbody.appendChild(tr);
    });

    const activeClients = clients.filter(c => c.installments_left > 0);
    const total = activeClients.length * monthlyFee;
    document.getElementById('due-value').textContent = formatBRL(total);
    document.getElementById('due-meta').textContent = activeClients.length + ' cliente' + (activeClients.length===1?'':'s') + ' ativo' + (activeClients.length===1?'':'s') + ' × ' + formatBRL(monthlyFee);
  }

  function renderDeletedClients(){
    const tbody = document.getElementById('deleted-tbody');
    const emptyEl = document.getElementById('deleted-empty');
    tbody.innerHTML = '';
    emptyEl.style.display = deletedClients.length === 0 ? 'block' : 'none';

    deletedClients.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = baseRowCellsHtml(c) +
        '<td data-label="Ações"><div class="row-actions">' +
            '<button class="icon-btn" data-action="notes" title="Notas">' + notesIcon() + '</button>' +
            '<button class="icon-btn" data-action="restore" title="Restaurar">' + restoreIcon() + '</button>' +
            '<button class="icon-btn danger" data-action="wipe" title="Excluir definitivamente">' + trashIcon() + '</button>' +
          '</div></td>';

      bindSecretToggles(tr);
      tr.querySelector('[data-action="notes"]').addEventListener('click', () => openNotesModal(c.id, true));
      tr.querySelector('[data-action="restore"]').addEventListener('click', () => restoreClient(c.id, c.name));
      tr.querySelector('[data-action="wipe"]').addEventListener('click', () => permanentlyDeleteClient(c.id, c.name));

      tbody.appendChild(tr);
    });
  }

  function bindSecretToggles(tr){
    tr.querySelectorAll('[data-action="toggle-secret"]').forEach(btn => {
      btn.addEventListener('click', function(){
        const span = this.previousElementSibling;
        const isHidden = span.textContent === '••••••••';
        span.textContent = isHidden ? span.dataset.secret : '••••••••';
      });
    });
  }

  function secretCellHtml(value){
    return '<div class="secret-cell"><span class="mono secret-value" data-secret="' + escapeHtml(value) + '">••••••••</span>' +
      '<button class="secret-toggle" data-action="toggle-secret" title="Mostrar/ocultar">' + eyeIcon() + '</button></div>';
  }

  function eyeIcon(){
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  }
  function editIcon(){
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  }
  function trashIcon(){
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
  }
  function notesIcon(){
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>';
  }
  function restoreIcon(){
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
  }

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ---------------- Edit passwords modal ----------------
  let editingClientId = null;
  const editModal = document.getElementById('edit-modal');

  function openEditModal(clientId){
    const c = clients.find(x => x.id === clientId);
    if(!c) return;
    editingClientId = clientId;
    document.getElementById('edit-modal-sub').textContent = 'Cliente: ' + c.name + ' — apenas as senhas podem ser alteradas.';
    document.getElementById('edit-password-input').value = c.password;
    document.getElementById('edit-usage-password-input').value = c.usage_password;
    editModal.classList.add('open');
  }
  document.getElementById('edit-modal-cancel').addEventListener('click', () => {
    editModal.classList.remove('open');
    editingClientId = null;
  });
  document.getElementById('edit-modal-save').addEventListener('click', async () => {
    const newPassword = document.getElementById('edit-password-input').value;
    const newUsagePassword = document.getElementById('edit-usage-password-input').value;
    const { error } = await sb.from('clients')
      .update({ password: newPassword, usage_password: newUsagePassword })
      .eq('id', editingClientId);
    if(error){ toast('Erro ao salvar senhas: ' + error.message, true); }
    else{ toast('Senhas atualizadas.'); await loadClients(); }
    editModal.classList.remove('open');
    editingClientId = null;
  });

  // ---------------- Notes modal ----------------
  let notesClientId = null;
  let notesIsDeletedList = false;
  const notesModal = document.getElementById('notes-modal');

  function openNotesModal(clientId, isDeletedList){
    const source = isDeletedList ? deletedClients : clients;
    const c = source.find(x => x.id === clientId);
    if(!c) return;
    notesClientId = clientId;
    notesIsDeletedList = isDeletedList;
    document.getElementById('notes-modal-sub').textContent = 'Cliente: ' + c.name;
    document.getElementById('notes-textarea').value = c.notes || '';
    notesModal.classList.add('open');
  }
  document.getElementById('notes-modal-cancel').addEventListener('click', () => {
    notesModal.classList.remove('open');
    notesClientId = null;
  });
  document.getElementById('notes-modal-save').addEventListener('click', async () => {
    const value = document.getElementById('notes-textarea').value;
    const { error } = await sb.from('clients').update({ notes: value }).eq('id', notesClientId);
    if(error){ toast('Erro ao salvar notas: ' + error.message, true); }
    else{
      toast('Notas atualizadas.');
      if(notesIsDeletedList) await loadDeletedClients(); else await loadClients();
    }
    notesModal.classList.remove('open');
    notesClientId = null;
  });

  // ---------------- Delete / restore / wipe ----------------
  async function deleteClient(id, name){
    if(!confirm('Mover "' + name + '" para Excluídos? Os dados ficam preservados e ele sai do valor devido.')) return;
    const { error } = await sb.from('clients').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if(error){ toast('Erro ao excluir: ' + error.message, true); return; }
    toast('Cliente movido para Excluídos.');
    await loadClients();
  }

  async function restoreClient(id, name){
    if(!confirm('Restaurar "' + name + '" para a lista de clientes ativos?')) return;
    const { error } = await sb.from('clients').update({ deleted_at: null }).eq('id', id);
    if(error){ toast('Erro ao restaurar: ' + error.message, true); return; }
    toast('Cliente restaurado.');
    await loadDeletedClients();
    await loadClients();
  }

  async function permanentlyDeleteClient(id, name){
    if(!confirm('Excluir "' + name + '" definitivamente? Essa ação NÃO pode ser desfeita e apaga todos os dados dele.')) return;
    const { error } = await sb.from('clients').delete().eq('id', id);
    if(error){ toast('Erro ao excluir definitivamente: ' + error.message, true); return; }
    toast('Cliente excluído definitivamente.');
    await loadDeletedClients();
  }

  // ---------------- Users (via Edge Function) ----------------
  async function authedFetch(path, options){
    options = options || {};
    options.headers = Object.assign({
      'Authorization': 'Bearer ' + currentSession.access_token,
      'apikey': SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json'
    }, options.headers || {});
    return fetch(FUNCTIONS_URL + '/admin-users' + path, options);
  }

  async function loadUsers(){
    const tbody = document.getElementById('users-tbody');
    try{
      const res = await authedFetch('', { method: 'GET' });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Erro ao carregar usuários.');
      renderUsers(data.users || []);
    }catch(e){
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint);">Não foi possível carregar usuários. Verifique se a Edge Function "admin-users" está publicada. (' + escapeHtml(e.message) + ')</td></tr>';
    }
  }

  function renderUsers(users){
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      const created = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—';
      tr.innerHTML =
        '<td class="name" data-label="E-mail">' + escapeHtml(u.email) + '</td>' +
        '<td class="mono" data-label="Criado em">' + created + '</td>' +
        '<td data-label="Ações"><div class="row-actions">' +
          '<button class="icon-btn danger" data-action="delete" title="Excluir">' + trashIcon() + '</button>' +
        '</div></td>';
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteUser(u.id, u.email));
      tbody.appendChild(tr);
    });
  }

  const userFormCard = document.getElementById('user-form-card');
  document.getElementById('toggle-user-form').addEventListener('click', () => {
    userFormCard.classList.toggle('open');
  });
  document.getElementById('cancel-user-form').addEventListener('click', () => {
    userFormCard.classList.remove('open');
    document.getElementById('user-form').reset();
  });

  document.getElementById('user-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const email = document.getElementById('u-username').value.trim();
    const password = document.getElementById('u-password').value;
    try{
      const res = await authedFetch('', { method: 'POST', body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Erro ao criar usuário.');
      toast('Usuário criado com sucesso.');
      this.reset();
      userFormCard.classList.remove('open');
      await loadUsers();
    }catch(err){
      toast(err.message, true);
    }
  });

  async function deleteUser(id, email){
    if(!confirm('Remover o acesso de "' + email + '"?')) return;
    try{
      const res = await authedFetch('', { method: 'DELETE', body: JSON.stringify({ id }) });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Erro ao remover usuário.');
      toast('Usuário removido.');
      await loadUsers();
    }catch(err){
      toast(err.message, true);
    }
  }

  // ---------------- Init: restore existing session, if any ----------------
  (async function init(){
    document.getElementById('login-hint').textContent = 'Faça login com um usuário criado no seu projeto Supabase.';
    const { data } = await sb.auth.getSession();
    if(data && data.session){
      await enterApp(data.session);
    }
  })();

})();
