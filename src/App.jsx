// Componente principal: controla sessão, perfil, dados compartilhados e telas.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { doc, onSnapshot } from 'firebase/firestore'
import { firestore } from './services/firebase.js'
import { ensureUserProfile, logoutUser, watchAuth } from './services/authService.js'
import { persistDbChanges, subscribeToAppData, syncItemAvailability } from './services/dataService.js'
import Auth from './routes/Auth.jsx'
import Admin from './routes/Admin.jsx'
import { Meus, Pedir } from './routes/User.jsx'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'

// Valores iniciais exibidos enquanto as coleções do Firestore carregam.
const EMPTY_DB = { items: [], loans: [], availability: [], users: [], cfg: { diasAviso: 1, maxDias: 30 } }
const UPDATES_VERSION = '2026-10-20-role-updates'
const ROLE_UPDATES = {
  user: {
    title: 'Novidades para usuários',
    items: [
      'No catálogo, você pode ver se um produto está disponível, emprestado ou reservado, além da previsão de retorno.',
      'Você pode reservar um período futuro após a data de retorno prevista do produto.',
      'A busca de produtos tem sugestões abaixo do campo e procura somente pelo nome do produto.',
      'Em “Meus empréstimos”, você pode buscar seus registros e consultar a data em que cada reserva foi feita.',
      'O catálogo e seu histórico mostram indicadores enquanto os dados estão carregando.',
    ],
  },
  admin: {
    title: 'Novidades para administradores',
    items: [
      'A busca do Painel filtra empréstimos e lembretes por produto, usuário, datas, status ou código.',
      'Na área Produtos, a busca filtra por nome, descrição e disponibilidade.',
      'Na aba Usuários, a busca encontra contas e empréstimos; os detalhes dos produtos agora podem ser expandidos ou recolhidos.',
      'O painel bloqueia a confirmação de retirada se o produto já estiver emprestado, inclusive em validações concorrentes.',
      'O painel mostra indicadores de carregamento para empréstimos, produtos e dados de usuários.',
      'As reservas futuras são registradas no Firestore e a disponibilidade compartilhada é sincronizada pelo painel.',
    ],
  },
}

export default function App() {
  const [authUser, setAuthUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [db, setDb] = useState(EMPTY_DB)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('pedir')
  const [message, setMessage] = useState('')
  const [repairingProfile, setRepairingProfile] = useState(false)
  const [profileIssue, setProfileIssue] = useState(null)
  const [creatorEgg, setCreatorEgg] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const dbRef = useRef(EMPTY_DB)
  const syncedLoansRef = useRef('')
  const toastTimerRef = useRef(null)

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

  // Exibe cada comunicado uma vez por conta e por navegador.
  useEffect(() => {
    if (!profile) {
      setShowUpdates(false)
      return
    }
    const key = `esteamulab-updates-${UPDATES_VERSION}-${profile.role}-${profile.id}`
    try {
      setShowUpdates(localStorage.getItem(key) !== 'seen')
    } catch (error) {
      setMessage(`Não foi possível verificar as novidades já exibidas: ${error.message}`)
      setShowUpdates(true)
    }
  }, [profile])

  // Assina apenas os dados permitidos para o papel atual e recebe atualizações em tempo real.
  useEffect(() => {
    if (!authUser || !profile) return undefined
    setLoading(true)
    const unsubscribe = subscribeToAppData({
      uid: authUser.uid,
      isAdmin: profile.role === 'admin',
      onChange: next => {
        dbRef.current = next
        setDb(next)
        setLoading(false)
        if (profile.role === 'admin' && next.ready.all) {
          const serializedLoans = JSON.stringify([next.items, next.loans])
          if (serializedLoans !== syncedLoansRef.current) {
            syncedLoansRef.current = serializedLoans
            syncItemAvailability(next.loans, next.items).catch(error => {
              syncedLoansRef.current = ''
              setMessage(`Não foi possível sincronizar a disponibilidade: ${error.message}`)
            })
          }
        }
      },
      onError: error => {
        const permissionDenied = error.cause?.code === 'permission-denied'
        setMessage(permissionDenied
          ? `A leitura foi bloqueada em ${error.message}. Publique as regras atualizadas com: firebase deploy --only firestore:rules --project emprestimo-2026`
          : `Erro ao sincronizar dados: ${error.message}`)
        setLoading(false)
      },
    })
    return unsubscribe
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
    window.clearTimeout(toastTimerRef.current)
    setMessage(text)
    toastTimerRef.current = window.setTimeout(() => setMessage(''), 3500)
  }, [])

  function playCreatorJingle() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    const audio = new AudioContextClass()
    const notes = [587.33, 392, 659.25, 783.99, 523.25]
    let start = audio.currentTime
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator()
      const volume = audio.createGain()
      const length = index === notes.length - 1 ? 0.32 : 0.16
      oscillator.type = index % 2 ? 'square' : 'triangle'
      oscillator.frequency.setValueAtTime(frequency * 1.12, start)
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + 0.07)
      volume.gain.setValueAtTime(0.0001, start)
      volume.gain.exponentialRampToValueAtTime(0.11, start + 0.025)
      volume.gain.exponentialRampToValueAtTime(0.0001, start + length)
      oscillator.connect(volume); volume.connect(audio.destination)
      oscillator.start(start); oscillator.stop(start + length + 0.02)
      start += length + 0.035
    })
    const boing = audio.createOscillator()
    const boingVolume = audio.createGain()
    boing.type = 'sine'
    boing.frequency.setValueAtTime(240, start)
    boing.frequency.exponentialRampToValueAtTime(85, start + 0.36)
    boingVolume.gain.setValueAtTime(0.0001, start)
    boingVolume.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
    boingVolume.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)
    boing.connect(boingVolume); boingVolume.connect(audio.destination)
    boing.start(start); boing.stop(start + 0.4)
    window.setTimeout(() => audio.close().catch(() => {}), 1800)
  }

  const surpriseCreator = useCallback(() => {
    setCreatorEgg(true)
    playCreatorJingle()
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

  function dismissUpdates() {
    if (!profile) return
    const key = `esteamulab-updates-${UPDATES_VERSION}-${profile.role}-${profile.id}`
    try {
      localStorage.setItem(key, 'seen')
      setShowUpdates(false)
    } catch (error) {
      setMessage(`Não foi possível salvar que você já viu as novidades: ${error.message}`)
    }
  }

  // Aguarda a validação da sessão, do perfil e das permissões antes de mostrar a tela.
  if (loading) return <main className="loading-screen"><img className="loading-logo" src="/logos/esteamulab-logo.png" alt="ESTEAMULAB" /><div className="loading-spinner" /><p>Preparando suas descobertas...</p></main>

  const props = { db, update, toast, user: profile }

  return (
    <>
      <Navbar profile={profile} onLogout={logoutUser} />

      <main className="container pb-5" style={{ maxWidth: 960 }}>
        {!authUser && <Auth toast={toast} onCreatorClick={surpriseCreator} />}
        {profile && showUpdates && (
          <section className="updates-notice mb-4" aria-labelledby="updates-title">
            <div className="updates-heading">
              <div>
                <span className="updates-kicker">NOVIDADES DO ESTEAMULAB</span>
                <h2 id="updates-title">{ROLE_UPDATES[profile.role].title}</h2>
              </div>
              <button className="btn btn-sm btn-outline-secondary" type="button" onClick={dismissUpdates}>
                Entendi, fechar
              </button>
            </div>
            <ul className="mb-0">
              {ROLE_UPDATES[profile.role].items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>
        )}
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

      <Footer profile={profile} />
      <Analytics />

      {creatorEgg && <div className="creator-egg-backdrop" role="presentation">
        <section className="creator-egg" role="dialog" aria-modal="true" aria-labelledby="creator-egg-title">
          <button className="creator-egg-close" type="button" aria-label="Fechar surpresa" onClick={() => setCreatorEgg(false)}>×</button>
          <div className="egg-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--left': `${index * 5.55}%`, '--duration': `${1.6 + index % 5 * 0.25}s`, '--delay': `${index % 7 * -0.4}s` }} />)}</div>
          <img className="egg-cashew" src="/caju-favicon.png" alt="" />
          <img className="egg-portrait" src="/creator/samuel.webp" alt="Samuel, criador do ESTEAMULAB" />
          <span className="egg-kicker">SEGREDO DESBLOQUEADO</span>
          <h2 id="creator-egg-title">O criador apareceu!</h2>
          <p>Samuel Anderson Machado Lopes<br /><strong>Gênio do empréstimo. Lenda do caju.</strong></p>
          <span className="egg-jingle-note">♪ plim-plim · boing! ♪</span>
          <button className="btn btn-dark egg-ok" type="button" onClick={() => setCreatorEgg(false)}>Voltar à missão</button>
        </section>
      </div>}

      {message && (
        <div className="toast-box" role="status" aria-live="polite">
          <div className="toast-notice" key={message}>
            <span className="notice-icon" aria-hidden="true"><img src="/caju-favicon.png" alt="" /></span>
            <div className="notice-copy"><span className="notice-label">ESTEAMULAB · AVISO</span><span>{message}</span></div>
            <button className="notice-close" type="button" aria-label="Fechar aviso" onClick={() => { window.clearTimeout(toastTimerRef.current); setMessage('') }}>×</button>
            <span className="notice-progress" />
          </div>
        </div>
      )}
    </>
  )
}
