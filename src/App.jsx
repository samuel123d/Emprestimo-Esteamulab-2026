// Componente principal: controla sessão, perfil, dados compartilhados e telas.
import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from './services/firebase.js'
import { ensureUserProfile, logoutUser, watchAuth } from './services/authService.js'
import { persistDbChanges, subscribeToAppData } from './services/dataService.js'
import Auth from './routes/Auth.jsx'
import Admin from './routes/Admin.jsx'
import { Meus, Pedir } from './routes/User.jsx'

// Valores iniciais exibidos enquanto as coleções do Firestore carregam.
const EMPTY_DB = { items: [], loans: [], users: [], cfg: { diasAviso: 1, maxDias: 30 } }

export default function App() {
  const [authUser, setAuthUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [db, setDb] = useState(EMPTY_DB)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('pedir')
  const [message, setMessage] = useState('')
  const [repairingProfile, setRepairingProfile] = useState(false)
  const [profileIssue, setProfileIssue] = useState(null)
  const dbRef = useRef(EMPTY_DB)

  // Acompanha login e logout feitos pelo Firebase Authentication.
  useEffect(() => watchAuth(user => {
    setAuthUser(user)
    setProfile(null)
    setProfileIssue(null)
    setLoading(Boolean(user))
    setMessage('')
    if (!user) {
      dbRef.current = EMPTY_DB
      setDb(EMPTY_DB)
    }
  }), [])

  // Lê o papel da conta no Firestore; o usuário não pode alterar o próprio papel.
  useEffect(() => {
    if (!authUser) return undefined
    return onSnapshot(doc(firestore, 'users', authUser.uid), snapshot => {
      if (!snapshot.exists()) {
        setProfile(null)
        setProfileIssue('missing')
        setLoading(false)
        return
      }

      const data = snapshot.data()
      if (!['user', 'admin'].includes(data.role)) {
        setProfile(null)
        setProfileIssue('invalid-role')
        setLoading(false)
        return
      }
      setProfileIssue(null)
      setProfile({ id: authUser.uid, ...data, nome: data.name, contato: data.email })
    }, error => {
      setProfileIssue(error.code || 'read-error')
      setMessage(`Não foi possível carregar seu perfil: ${error.message}`)
      setLoading(false)
    })
  }, [authUser])

  // Assina apenas os dados permitidos para o papel atual e recebe atualizações em tempo real.
  useEffect(() => {
    if (!authUser || !profile) return undefined
    setLoading(true)
    return subscribeToAppData({
      uid: authUser.uid,
      isAdmin: profile.role === 'admin',
      onChange: next => {
        dbRef.current = next
        setDb(next)
        setLoading(false)
      },
      onError: error => {
        setMessage(`Erro ao sincronizar dados: ${error.message}`)
        setLoading(false)
      },
    })
  }, [authUser, profile])

  // Atualiza o estado da interface e grava somente as mudanças no Firestore.
  const update = useCallback(change => {
    const previous = dbRef.current
    const next = structuredClone(previous)
    change(next)
    dbRef.current = next
    setDb(next)
    persistDbChanges(previous, next).catch(error => {
      setMessage(`Não foi possível salvar: ${error.message}`)
    })
  }, [])

  // Exibe uma mensagem temporária para confirmar ações ou informar erros.
  const toast = useCallback(text => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 3500)
  }, [])

  // Repara um perfil ausente sempre com o papel comum; o Firestore valida a criação.
  async function repairProfile() {
    if (!authUser) return
    setRepairingProfile(true)
    try {
      await ensureUserProfile(authUser)
      toast('Perfil criado. Carregando o aplicativo...')
    } catch (error) {
      const detail = error.code === 'permission-denied'
        ? 'O Firestore negou a criação. Confira se o banco existe e publique firestore.rules.'
        : `Não foi possível criar o perfil: ${error.message}`
      setMessage(detail)
    } finally {
      setRepairingProfile(false)
    }
  }

  // Encerra a sessão para permitir que a pessoa volte à tela de entrada.
  async function returnToLogin() {
    try {
      await logoutUser()
    } catch (error) {
      setMessage(`Não foi possível sair: ${error.message}`)
    }
  }

  // Aguarda a validação da sessão, do perfil e das permissões antes de mostrar a tela.
  if (loading) return <main className="container py-5 text-center">Carregando...</main>

  const props = { db, update, toast, user: profile }

  return (
    <>
      <nav className="navbar navbar-dark mb-4">
        <div className="container">
          <span className="navbar-brand fw-semibold">ESTEAMULAB</span>
          {profile && (
            <span className="text-white-50 small d-flex align-items-center gap-3">
              <span>{profile.nome} ({profile.role === 'admin' ? 'administrador' : 'usuário'})</span>
              <button className="btn btn-sm btn-outline-light" onClick={() => logoutUser()}>
                Sair
              </button>
            </span>
          )}
        </div>
      </nav>

      <main className="container pb-5" style={{ maxWidth: 960 }}>
        {!authUser && <Auth toast={toast} />}
        {authUser && !profile && (
          <div className="alert alert-danger">
            <p className="mb-2">
              {profileIssue === 'missing'
                ? 'A conta existe no Authentication, mas falta o perfil correspondente no Firestore.'
                : profileIssue === 'invalid-role'
                  ? 'O perfil existe, mas o campo role precisa ser user ou admin.'
                  : 'Não foi possível ler o perfil no Firestore. Confira as regras e o documento da conta.'}
            </p>
            <p className="small mb-2">No Firestore, o documento precisa estar em <code>users/{authUser.uid}</code>. Conta: {authUser.email || 'sem e-mail'}.</p>
            {profileIssue === 'permission-denied' && <p className="small mb-2">A leitura foi bloqueada pelas regras. Publique as regras atualizadas do arquivo <code>firestore.rules</code>.</p>}
            <div className="d-flex flex-wrap gap-2">
              {profileIssue === 'missing' && (
                <button className="btn btn-sm btn-danger" onClick={repairProfile} disabled={repairingProfile}>
                  {repairingProfile ? 'Tentando...' : 'Criar perfil comum de usuário'}
                </button>
              )}
              <button className="btn btn-sm btn-outline-dark" onClick={returnToLogin}>
                Voltar para o login
              </button>
            </div>
          </div>
        )}
        {profile?.role === 'admin' && <Admin {...props} />}
        {profile?.role === 'user' && (
          <>
            <ul className="nav nav-pills mb-4">
              {[
                ['pedir', 'Pedir empréstimo'],
                ['meus', 'Meus empréstimos'],
              ].map(([key, label]) => (
                <li className="nav-item" key={key}>
                  <button className={`nav-link ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            {view === 'pedir' ? <Pedir {...props} /> : <Meus {...props} />}
          </>
        )}
      </main>

      {message && (
        <div className="toast-box">
          <div className="toast show text-bg-dark"><div className="toast-body">{message}</div></div>
        </div>
      )}
    </>
  )
}
