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
    });
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

  // ---------------- Load & render clients ----------------
  async function loadClients(){
    const { data, error } = await sb.from('clients').select('*').order('created_at', { ascending: false });
    if(error){ toast('Erro ao carregar clientes: ' + error.message, true); return; }
    clients = data || [];
    renderClients();
  }

  function ringStyle(pctLeft){
    return 'background: conic-gradient(var(--accent) ' + (pctLeft*3.6) + 'deg, var(--border) ' + (pctLeft*3.6) + 'deg 360deg);';
  }

  function renderClients(){
    const tbody = document.getElementById('clients-tbody');
    const emptyEl = document.getElementById('clients-empty');
    tbody.innerHTML = '';
    emptyEl.style.display = clients.length === 0 ? 'block' : 'none';

    clients.forEach(c => {
      const tr = document.createElement('tr');
      const pctLeft = c.installments_total > 0 ? Math.round((c.installments_left / c.installments_total) * 100) : 0;
      const done = c.installments_left <= 0;

      tr.innerHTML =
        '<td class="name" data-label="Nome">' + escapeHtml(c.name) + '</td>' +
        '<td class="mono" data-label="Conta iCloud">' + escapeHtml(c.account) + '</td>' +
        '<td data-label="Senha iCloud">' + secretCellHtml(c.password) + '</td>' +
        '<td data-label="Senha (tempo de uso)">' + secretCellHtml(c.usage_password) + '</td>' +
        '<td class="mono" data-label="Telefone">' + escapeHtml(c.phone) + '</td>' +
        '<td data-label="Chave de acesso">' + secretCellHtml(c.access_key) + '</td>' +
        '<td data-label="Parcelas">' + (done ?
            '<span class="badge-done">Quitado</span>' :
            '<div class="installments"><div class="ring" style="' + ringStyle(pctLeft) + '"><div class="ring-inner"></div></div>' +
            '<div class="count"><b>' + c.installments_left + '</b> <small>/ ' + c.installments_total + '</small></div></div>'
          ) + '</td>' +
        '<td data-label="Ações"><div class="row-actions">' +
            '<button class="icon-btn" data-action="edit" title="Editar senhas">' + editIcon() + '</button>' +
            '<button class="icon-btn danger" data-action="delete" title="Excluir">' + trashIcon() + '</button>' +
          '</div></td>';

      tr.querySelectorAll('[data-action="toggle-secret"]').forEach(btn => {
        btn.addEventListener('click', function(){
          const span = this.previousElementSibling;
          const isHidden = span.textContent === '••••••••';
          span.textContent = isHidden ? span.dataset.secret : '••••••••';
        });
      });
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(c.id));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteClient(c.id, c.name));

      tbody.appendChild(tr);
    });

    const activeClients = clients.filter(c => c.installments_left > 0);
    const total = activeClients.length * 60;
    document.getElementById('due-value').textContent = formatBRL(total);
    document.getElementById('due-meta').textContent = activeClients.length + ' cliente' + (activeClients.length===1?'':'s') + ' ativo' + (activeClients.length===1?'':'s') + ' × R$ 60,00';
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

  async function deleteClient(id, name){
    if(!confirm('Excluir o cliente "' + name + '"? Esta ação não pode ser desfeita.')) return;
    const { error } = await sb.from('clients').delete().eq('id', id);
    if(error){ toast('Erro ao excluir: ' + error.message, true); return; }
    toast('Cliente removido.');
    await loadClients();
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
