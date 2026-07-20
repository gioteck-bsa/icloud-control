// Edge Function: admin-users
// Lista, cria e remove usuários do sistema (Supabase Auth), usando a
// service role key no lado do servidor — essa chave NUNCA vai para o navegador.
//
// Deploy:
//   supabase functions deploy admin-users
//
// Este arquivo usa automaticamente as variáveis de ambiente que o Supabase
// já injeta em toda Edge Function: SUPABASE_URL, SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY. Não é preciso configurar nada manualmente.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Não autenticado." }, 401);
  }

  // Cliente autenticado com o token de quem chamou, só para confirmar login válido
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return json({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  // Cliente com privilégios administrativos (só existe aqui no servidor)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (req.method === "GET") {
      const { data, error } = await admin.auth.admin.listUsers();
      if (error) throw error;
      const users = data.users
        .map((u) => ({ id: u.id, email: u.email, created_at: u.created_at }))
        .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return json({ users });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const email = (body.email || "").trim();
      const password = body.password || "";
      if (!email || !password) throw new Error("E-mail e senha são obrigatórios.");
      if (password.length < 6) throw new Error("A senha precisa ter ao menos 6 caracteres.");
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      return json({ user: { id: data.user.id, email: data.user.email } });
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      const id = body.id;
      if (!id) throw new Error("ID do usuário é obrigatório.");
      if (id === user.id) throw new Error("Você não pode remover seu próprio usuário.");
      const { data: listData } = await admin.auth.admin.listUsers();
      if ((listData?.users?.length || 0) <= 1) {
        throw new Error("É necessário manter ao menos um usuário no sistema.");
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Método não suportado." }, 405);
  } catch (e) {
    return json({ error: e.message || "Erro inesperado." }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
