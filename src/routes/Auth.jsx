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
    <section className="card shadow-sm mx-auto" style={{ maxWidth: 420 }}>
      <div className="card-body">
        <h5 className="mb-2">{isRegistering ? 'Criar conta de usuário' : 'Acessar o sistema'}</h5>
        <p className="text-muted small mb-3">
          Usuários podem entrar com e-mail e senha ou Google. Contas de administrador são criadas no Firebase.
        </p>

        <button type="button" className="btn btn-outline-secondary w-100" onClick={submitGoogle} disabled={sending}>
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
          <input id="auth-email" type="email" className="form-control mb-2" value={form.email} onChange={changeField('email')} autoComplete="email" required />

          <label className="form-label" htmlFor="auth-password">Senha</label>
          <input id="auth-password" type="password" className="form-control" value={form.password} onChange={changeField('password')} autoComplete={isRegistering ? 'new-password' : 'current-password'} minLength={6} required />

          {isRegistering ? (
            <>
              <label className="form-label mt-2" htmlFor="auth-confirm-password">Confirmar senha</label>
              <input id="auth-confirm-password" type="password" className="form-control" value={form.confirmPassword} onChange={changeField('confirmPassword')} autoComplete="new-password" minLength={6} required />
            </>
          ) : (
            <button type="button" className="btn btn-link p-0 small mt-2" onClick={resetPassword}>Esqueci minha senha</button>
          )}

          <button className="btn btn-dark w-100 mt-3" disabled={sending}>
            {sending ? 'Aguarde...' : isRegistering ? 'Criar conta de usuário' : 'Entrar'}
          </button>
        </form>

        <div className="text-center mt-3 small">
          {isRegistering ? 'Já tem conta? ' : 'Ainda não tem conta? '}
          <a href="#auth" onClick={toggleMode}>{isRegistering ? 'Entrar' : 'Cadastrar usuário'}</a>
        </div>

      </div>
    </section>
  )
}
