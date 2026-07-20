# Icloud Control — versão Supabase

Sistema acessível de qualquer computador, com os dados salvos num banco de dados
na nuvem (Supabase), em vez de um arquivo local.

## Estrutura

```
icloud-control/
├── index.html
├── style.css
├── config.js              ← você vai preencher com suas chaves
├── app.js
└── supabase/
    ├── schema.sql          ← rodar no SQL Editor do Supabase
    └── functions/
        └── admin-users/
            └── index.ts    ← Edge Function para gerenciar usuários
```

## Passo 1 — Criar o projeto no Supabase

1. Acesse https://supabase.com e crie uma conta (ou faça login).
2. Clique em **New Project**, escolha um nome e uma senha para o banco.
3. Aguarde o projeto terminar de provisionar (1–2 minutos).

## Passo 2 — Criar as tabelas

1. No painel do projeto, vá em **SQL Editor > New query**.
2. Cole todo o conteúdo do arquivo `supabase/schema.sql` deste projeto.
3. Clique em **Run**.

Isso cria a tabela de clientes, a trava que impede editar qualquer campo além
das senhas, e a função que desconta 1 parcela por mês automaticamente.

## Passo 3 — Configurar o login (Auth)

1. Vá em **Authentication > Providers > Email**.
2. Desative **"Allow new users to sign up"** — assim ninguém cria login sozinho,
   só quem for cadastrado por você.
3. (Opcional, para simplificar) desative a exigência de confirmação por e-mail.
4. Vá em **Authentication > Users > Add user** e crie o primeiro usuário do
   sistema (e-mail + senha) — esse será seu login inicial.

## Passo 4 — Publicar a Edge Function de usuários

Essa função permite criar/remover outros usuários do sistema pela própria tela
do app, sem expor nenhuma chave sensível no navegador.

1. Instale a CLI do Supabase (uma vez só):
   ```
   npm install -g supabase
   ```
2. Na pasta deste projeto, faça login e vincule ao seu projeto:
   ```
   supabase login
   supabase link --project-ref SEU-PROJECT-REF
   ```
   (o `SEU-PROJECT-REF` está em Project Settings > General)
3. Publique a função:
   ```
   supabase functions deploy admin-users
   ```

Não é preciso configurar nenhuma variável manualmente — o Supabase já injeta
automaticamente as chaves necessárias dentro da função.

## Passo 5 — Configurar o front-end

Abra `config.js` e preencha:

```js
const SUPABASE_CONFIG = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "sua-chave-anon-public"
};
```

Essas duas informações estão em **Project Settings > API** do seu projeto.
A chave `anon public` é segura para ficar no front-end (é isso que o Supabase
usa a autenticação e as regras de acesso — RLS — para proteger os dados).
**Nunca** coloque a chave `service_role` neste arquivo.

## Passo 6 — Hospedar o site

Como é um site estático (HTML/CSS/JS puro), qualquer uma dessas opções
funciona bem e tem plano gratuito:

- **Netlify**: arraste a pasta do projeto em https://app.netlify.com/drop
- **Vercel**: `vercel deploy` na pasta do projeto (via CLI) ou importe pelo site
- **GitHub Pages**: suba os arquivos num repositório e ative Pages nas configurações

Depois de publicado, você acessa o sistema pela URL gerada, de qualquer
computador ou celular — o login e os dados são os mesmos em todos os lugares,
porque tudo fica no Supabase.

## Resumo do que muda em relação à versão em arquivo local

- Login agora é autenticação real (Supabase Auth), não mais um usuário fixo
  salvo em arquivo.
- Os dados dos clientes ficam no Postgres do Supabase, protegidos por RLS
  (só usuários autenticados enxergam e editam).
- A regra "só a senha pode ser editada depois de criado" é garantida também
  no banco (trigger), não só na tela.
- A aba Usuários não mostra mais a senha de outros usuários do sistema depois
  de criada — isso é esperado, pois agora são contas reais com senha
  criptografada, não texto puro salvo num arquivo.
- A lista de clientes atualiza automaticamente em tempo real se outra pessoa
  cadastrar ou editar algo em outro computador (Realtime do Supabase).
