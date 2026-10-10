// Tela de acesso: usuários podem cadastrar ou entrar por e-mail e também usar Google.
import { useState } from 'react'
import { loginAdmin, loginUser, loginWithGoogle, registerUser, requestPasswordReset } from '../services/authService.js'

// Converte erros do Firebase em instruções que façam sentido para a pessoa usuária.
function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já tem uma conta. Entre com sua senha ou use Google.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/weak-password': 'A senha precisa ter ao menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet e tente novamente.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.',
    'auth/operation-not-allowed': 'Ative os métodos de acesso usados pelo app no Firebase Authentication.',
    'auth/unauthorized-domain': 'Adicione o domínio do aplicativo aos domínios autorizados do Firebase.',
    'auth/account-exists-with-different-credential': 'Este e-mail já tem conta. Entre com e-mail e senha para vincular o Google.',
    'app/not-admin': 'Esta conta ainda não é administradora. Defina role como admin no perfil dela no Firestore.',
  }
  return messages[error.code] || 'Não foi possível concluir. Confira os dados e tente novamente.'
}

export default function Auth({ toast }) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [adminForm, setAdminForm] = useState({ email: '', password: '' })
  const [sending, setSending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Mantém o campo correspondente sincronizado com o formulário.
  function changeField(field) {
    return event => setForm(current => ({ ...current, [field]: event.target.value }))
  }

  // Mantém as credenciais administrativas separadas do cadastro de usuários.
  function changeAdminField(field) {
    return event => setAdminForm(current => ({ ...current, [field]: event.target.value }))
  }

  // Registra um usuário comum ou autentica uma conta existente por e-mail e senha.
  async function submitEmail(event) {
    event.preventDefault()
    if (isRegistering && form.password !== form.confirmPassword) {
      toast('As senhas não conferem.')
      return
    }

    setSending(true)
    try {
      if (isRegistering) {
        await registerUser(form)
        toast('Conta criada. Você já pode usar o sistema.')
      } else {
        await loginUser(form)
      }
    } catch (error) {
      toast(authErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  // Abre o Google para autenticar ou cadastrar automaticamente um usuário comum.
  async function submitGoogle() {
    setSending(true)
    try {
      await loginWithGoogle()
    } catch (error) {
      toast(authErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  // Autentica a conta do administrador e confirma o papel no perfil do Firestore.
  async function submitAdmin(event) {
    event.preventDefault()
    setSending(true)
    try {
      await loginAdmin(adminForm)
    } catch (error) {
      toast(authErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  // Redefine a senha da conta administrativa usando o e-mail informado nessa seção.
  async function resetAdminPassword() {
    if (!adminForm.email.trim()) {
      toast('Informe o e-mail do administrador para receber o link.')
      return
    }
    try {
      await requestPasswordReset(adminForm.email)
      toast('Se esse e-mail estiver cadastrado, receberá um link para redefinir a senha.')
    } catch (error) {
      toast(authErrorMessage(error))
    }
  }

  // Envia um link de redefinição de senha para o e-mail informado.
  async function resetPassword() {
    if (!form.email.trim()) {
      toast('Informe seu e-mail para receber o link de redefinição.')
      return
    }
    try {
      await requestPasswordReset(form.email)
      toast('Se esse e-mail estiver cadastrado, você receberá um link para redefinir a senha.')
    } catch (error) {
      toast(authErrorMessage(error))
    }
  }

  // Alterna entre cadastro de usuário e entrada sem oferecer criação de administradores.
  function toggleMode(event) {
    event.preventDefault()
    setIsRegistering(current => !current)
  }

  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" />
        <img className="auth-brand-logo" src="/logos/esteamulab-logo.png" alt="ESTEAMULAB — Espaço para pensar, criar e inovar" />
        <span className="auth-kicker">CRIAR · EXPLORAR · APRENDER</span>
        <h1>Ideias em movimento.<br /><span>Conhecimento compartilhado.</span></h1>
        <p>Um espaço para emprestar, experimentar e transformar curiosidade em novas descobertas.</p>
        <div className="auth-steps"><span>01 <b>Escolha</b></span><span>02 <b>Explore</b></span><span>03 <b>Compartilhe</b></span></div>
      </div>
      <div className="card auth-card">
      <div className="card-body">
        <div className="auth-card-heading"><span className="auth-mini-icon"><img src="/caju-favicon.png" alt="" /></span><div><h2>{isRegistering ? 'Sua próxima ideia começa aqui' : 'Que bom ter você por aqui'}</h2><p>{isRegistering ? 'Crie sua conta para começar a explorar.' : 'Entre e continue de onde a curiosidade te levar.'}</p></div></div>
        <h5 className="mb-2">{isRegistering ? 'Criar conta de usuário' : 'Acessar o sistema'}</h5>
        <p className="text-muted small mb-3">
          Usuários podem entrar com e-mail e senha ou Google. Contas de administrador são criadas no Firebase.
        </p>

        <button type="button" className="btn btn-outline-secondary w-100 auth-google" data-tooltip="Entre com a sua conta Google" onClick={submitGoogle} disabled={sending}>
          <span className="google-mark" aria-hidden="true">G</span>
          Continuar com Google
        </button>

        <div className="d-flex align-items-center gap-3 my-3 text-muted small" aria-hidden="true">
          <hr className="flex-grow-1 my-0" />
          <span>ou com e-mail</span>
          <hr className="flex-grow-1 my-0" />
        </div>

        <form onSubmit={submitEmail}>
          {isRegistering && (
            <>
              <label className="form-label" htmlFor="auth-name">Nome</label>
              <input id="auth-name" className="form-control mb-2" value={form.name} onChange={changeField('name')} autoComplete="name" required />
            </>
          )}

          <label className="form-label" htmlFor="auth-email">E-mail</label>
          <input id="auth-email" type="email" className="form-control mb-2" placeholder="Digite seu e-mail" value={form.email} onChange={changeField('email')} autoComplete="email" required />

          <label className="form-label" htmlFor="auth-password">Senha</label>
          <div className="password-field">
            <input id="auth-password" type={showPassword ? 'text' : 'password'} className="form-control" placeholder="Digite sua senha" value={form.password} onChange={changeField('password')} autoComplete={isRegistering ? 'new-password' : 'current-password'} minLength={6} required />
            <button className="password-visibility" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword} title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {showPassword
                  ? <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>
                  : <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 6.2a1.5 1.5 0 0 1 0 1.6 13 13 0 0 1-3 3.4" /><path d="M6.2 6.2a13.4 13.4 0 0 0-3.7 5 1.5 1.5 0 0 0 0 1.6C3.5 14.5 7 19 12 19a10 10 0 0 0 3-.5" /></>}
              </svg>
            </button>
          </div>

          {isRegistering ? (
            <>
              <label className="form-label mt-2" htmlFor="auth-confirm-password">Confirmar senha</label>
              <div className="password-field">
                <input id="auth-confirm-password" type={showConfirmPassword ? 'text' : 'password'} className="form-control" placeholder="Repita sua senha" value={form.confirmPassword} onChange={changeField('confirmPassword')} autoComplete="new-password" minLength={6} required />
                <button className="password-visibility" type="button" onClick={() => setShowConfirmPassword(value => !value)} aria-label={showConfirmPassword ? 'Ocultar confirmação da senha' : 'Mostrar confirmação da senha'} aria-pressed={showConfirmPassword} title={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    {showConfirmPassword
                      ? <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>
                      : <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 6.2a1.5 1.5 0 0 1 0 1.6 13 13 0 0 1-3 3.4" /><path d="M6.2 6.2a13.4 13.4 0 0 0-3.7 5 1.5 1.5 0 0 0 0 1.6C3.5 14.5 7 19 12 19a10 10 0 0 0 3-.5" /></>}
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="btn btn-link p-0 small mt-2" data-tooltip="Enviaremos um link para o seu e-mail" onClick={resetPassword}>Esqueci minha senha</button>
          )}

          <button className="btn btn-dark w-100 mt-3 auth-submit" data-tooltip={isRegistering ? 'Criar sua conta e começar' : 'Acessar o sistema'} disabled={sending}>
            {sending ? 'Aguarde...' : isRegistering ? 'Criar conta de usuário' : 'Entrar'}
          </button>
        </form>

        <div className="text-center mt-3 small">
          {isRegistering ? 'Já tem conta? ' : 'Ainda não tem conta? '}
          <a href="#auth" onClick={toggleMode}>{isRegistering ? 'Entrar' : 'Cadastrar usuário'}</a>
        </div>

      </div>
      </div>
      <div className="institutional-logos" aria-label="Instituições parceiras">
        <span className="institutional-label">UMA INICIATIVA EM REDE</span>
        <div className="institutional-logo-row">
          <img className="logo-ufrn" src="/logos/ufrn.png" alt="Universidade Federal do Rio Grande do Norte" />
          <img className="logo-giife" src="/logos/giife.png" alt="GIIfE" />
          <img className="logo-imd" src="/logos/imd.png" alt="Instituto Metrópole Digital" />
        </div>
      </div>
    </section>
  )
}
