# eSTEAMulab — Sistema de empréstimo

Aplicação web para controlar o empréstimo de produtos. Usuários podem criar uma conta, entrar com e-mail e senha ou Google, consultar produtos disponíveis e acompanhar seus empréstimos. Administradores gerenciam produtos, fotos, usuários e empréstimos.

## Requisitos

- Node.js e npm instalados.
- Um projeto Firebase com Authentication e Cloud Firestore habilitados.
- Fotos de produtos compactadas no navegador e salvas no Firestore junto ao cadastro.

## Instalação e execução

Na pasta do projeto, instale as dependências:

```bash
npm install
```

Configure as variáveis do Firebase copiando `.env.example` para `.env.local` e preenchendo os valores do seu app Web Firebase:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

Inicie o servidor de desenvolvimento na porta **8080**:

```bash
npm start
```

Abra [http://localhost:8080](http://localhost:8080). Para usar o servidor Vite padrão, execute `npm run dev`.

## Publicar no Vercel

Importe o repositório no Vercel usando a pasta raiz do projeto. O Vercel detecta Vite automaticamente; use `npm run build` como comando de build e `dist` como diretório de saída.

Em **Project Settings → Environment Variables**, cadastre as variáveis `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` e `VITE_FIREBASE_APP_ID` com os valores do app Web Firebase. `VITE_FIREBASE_MEASUREMENT_ID` é opcional. A configuração local em `.env.local` não é enviada ao repositório; depois de cadastrar ou alterar as variáveis no Vercel, faça um novo deploy para incorporá-las ao build.

## Configuração do Firebase

### Firebase Hosting

Instale a CLI do Firebase e entre na sua conta:

```bash
npm install -g firebase-tools
firebase login
```

Na pasta do projeto, associe-o ao projeto Firebase onde Authentication e Firestore foram configurados:

```bash
firebase use --add
```

Selecione o projeto correto. O comando salva a associação local em `.firebaserc`. Depois, gere o build e publique:

```bash
npm run deploy:firebase
```

O Firebase Hosting serve os arquivos de `dist/` e redireciona as rotas da aplicação React para `index.html`. Ao concluir, a CLI informa os endereços `web.app` e `firebaseapp.com`. Para publicar atualizações, execute `npm run deploy:firebase` novamente.

### Authentication

No Firebase Console, abra **Authentication → Sign-in method** e habilite:

- **E-mail/senha**
- **Google**

Em **Authentication → Settings → Authorized domains**, inclua o domínio onde a aplicação será publicada. O login Google abre uma janela pop-up; permita pop-ups para esse domínio se o navegador bloquear a janela.

O cadastro pelo site cria contas comuns. A aplicação não oferece cadastro de administrador.

### Firestore

Crie o banco em **Firestore Database** e publique as regras do arquivo `firestore.rules`:

```bash
firebase deploy --only firestore:rules --project emprestimo-2026
```

As regras permitem que cada usuário leia seu perfil e seus empréstimos. Administradores são identificados pelo campo `role: "admin"` no documento `users/{UID}`.

### Criar ou promover um administrador

1. Crie a conta pelo site, usando o e-mail/senha ou Google desejado.
2. No Firebase Console, abra **Authentication → Users** e copie o UID dessa conta.
3. Em **Firestore Database → Data**, abra a coleção `users` e o documento cujo ID é o UID copiado.
4. Altere o campo `role` de `user` para `admin` e salve.

Se o documento ainda não existir, crie `users/{UID}` com os campos `name`, `email`, `role` (`admin`) e `createdAt`. A conta deve existir primeiro em Authentication. O papel não pode ser alterado pelo formulário do site.

### Avisos de devolução por e-mail

No painel, **Abrir no Gmail** prepara uma mensagem para o endereço cadastrado, com assunto, data, código e contagem regressiva até o fim do dia de devolução. Na tela **Meus empréstimos**, o tempo restante é atualizado a cada segundo. É necessário estar conectado ao Gmail no navegador; confira a mensagem e clique em **Enviar**. O site não consegue confirmar se ela foi enviada. O envio automático diário não está ativo nesta configuração.

### Fotos dos produtos

As imagens são otimizadas no navegador e salvas como Data URL no campo `photoUrl` do produto no Firestore, seguindo o fluxo do repositório S4Solution-Retirada. Não é necessário configurar Cloudinary nem Firebase Storage para enviar fotos. Imagens PNG, JPEG e WebP de até 20 MB são aceitas; antes de salvar, são redimensionadas e convertidas para JPEG para respeitar o limite de tamanho por documento do Firestore.

## Comandos disponíveis

| Comando | Descrição |
| --- | --- |
| `npm start` | Inicia o servidor na porta 8080, acessível na rede local. |
| `npm run dev` | Inicia o servidor de desenvolvimento Vite. |
| `npm run build` | Gera a versão de produção na pasta `dist/`. |
| `npm run preview` | Visualiza localmente a versão gerada em `dist/`. |
| `npm run deploy` | Gera a versão de produção e publica no GitHub Pages usando `gh-pages`. |
| `npm run deploy:firebase` | Gera a versão de produção e publica no Firebase Hosting. |

## Estrutura do projeto

```text
src/
├── routes/                 # Telas de login, usuário e administração
├── services/               # Integração Firebase: autenticação, dados e fotos
├── utils/                  # Funções e componentes compartilhados
├── App.jsx                 # Sessão, perfil e navegação principal
├── main.jsx                # Inicialização do React
└── styles.css              # Estilos globais
firestore.rules             # Regras de acesso ao Firestore
firebase.json               # Configuração de deploy das regras Firebase
.env.example                # Modelo das variáveis de configuração
```

## Observação sobre dados antigos

Dados salvos anteriormente no `localStorage` de outro navegador não são migrados automaticamente para o Firestore. Contas locais também precisam ser cadastradas novamente pelo fluxo do Firebase Authentication.
