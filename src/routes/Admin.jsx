import { useState, useEffect } from 'react'
import { today, fmt, fmtDataHora, ativo, itemLivre, itemNome, uid, lembretes, quando, linkContato, linkEmail, Status, tempoEmprestimo } from '../utils/lib.jsx'
import { uploadProductPhoto } from '../services/imageService.js'
import { confirmLoanStatus, deleteProduct, saveProduct } from '../services/dataService.js'

// Organiza o painel administrativo em quatro áreas navegáveis.
export default function Admin(props) {
  const [tab, setTab] = useState('painel')
  const [, tick] = useState(0)

  // reavalia os lembretes a cada minuto
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(t) }, [])
  // notificação do navegador (uma vez por dia)
  useEffect(() => {
    const n = lembretes(props.db), k = 'avisado_' + today()
    if (n.length && 'Notification' in window && Notification.permission === 'granted' && !sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, '1')
      new Notification('ESTEAMULAB', { body: `${n.length} devolução(ões) próxima(s) ou atrasada(s).` })
    }
  }, [props.db])

  const tabs = { painel: ['Painel', Painel], produtos: ['Produtos', Produtos], usuarios: ['Usuários', Usuarios], config: ['Configurações', Config] }
  const View = tabs[tab][1]
  return (
    <>
      <ul className="nav nav-tabs mb-3">
        {Object.entries(tabs).map(([k, [n]]) => (
          <li className="nav-item" key={k}><button className={`nav-link ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{n}</button></li>
        ))}
      </ul>
      <View {...props} />
    </>
  )
}

// Reúne a validação de códigos, os lembretes e a tabela geral de empréstimos.
function Painel({ db, update, toast }) {
  const [cod, setCod] = useState('')
  const lem = lembretes(db)

  // Avança o empréstimo da reserva para retirada ou da retirada para devolução.
  async function validar() {
    const codigo = cod.trim().toUpperCase()
    const l = db.loans.find(x => ativo(x) && (x.codigo === codigo || x.codigoEntrega === codigo || (!x.codigoEntrega && x.codigo === codigo)))
    if (!l) return toast('Código não encontrado ou já finalizado.')

    const nome = itemNome(db, l.itemId)
    const isRetirada = l.status === 'reservado' && l.codigo === codigo
    const isEntrega = l.status === 'emprestado' && (l.codigoEntrega === codigo || (!l.codigoEntrega && l.codigo === codigo))
    if (!isRetirada && !isEntrega) return toast('Código não corresponde ao passo atual do empréstimo.')

    try {
      await confirmLoanStatus(
        l.id,
        isRetirada ? 'emprestado' : 'devolvido',
        isRetirada ? 'retirado' : 'devolvidoEm',
        new Date().toISOString(),
      )
      toast(isRetirada ? `Retirada confirmada: ${nome} com ${l.nome}.` : `Devolução confirmada: ${nome}.`)
      setCod('')
    } catch (error) {
      if (error.code === 'permission-denied') {
        return toast('O Firestore negou a validação. Publique as regras de firestore.rules e confirme que seu perfil está como admin.')
      }
      if (error.code === 'not-found') {
        return toast('Este empréstimo não existe mais no Firestore. Atualize a página e tente novamente.')
      }
      toast(`Não foi possível confirmar a validação no Firestore: ${error.message}`)
    }
  }
  // Cancela uma reserva sem apagar o histórico do empréstimo.
  const cancelar = id => update(d => { d.loans.find(x => x.id === id).status = 'cancelado' })

  return (
    <>
      {lem.length > 0 && (
        <div className="alert alert-warning">
          <strong>Lembretes de devolução ({lem.length})</strong>
          {lem.map(l => (
            <div key={l.id} className="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
              <span>{l.nome} · {itemNome(db, l.itemId)} · {quando(l.dias)}</span>
              {String(l.contato || '').includes('@')
                ? (
                  <button className="btn btn-sm btn-dark" onClick={() => window.open(linkEmail(db, l, new Date()), '_blank', 'noopener,noreferrer')}>
                    Abrir no Gmail
                  </button>
                )
                : (
                  <a className="btn btn-sm btn-dark" target="_blank" rel="noopener noreferrer" href={linkContato(db, l)}>
                    Avisar no WhatsApp
                  </a>
                )}
            </div>
          ))}
        </div>
      )}
      <form className="card shadow-sm mb-3" onSubmit={e => { e.preventDefault(); validar() }}><div className="card-body">
        <h6>Validar código (retirada ou devolução)</h6>
        <div className="input-group">
          <input className="form-control text-uppercase" maxLength={6} placeholder="Código do usuário" value={cod} onChange={e => setCod(e.target.value)} />
          <button className="btn btn-dark">Validar</button>
        </div>
      </div></form>
      <div className="card shadow-sm"><div className="card-body">
        <h6>Empréstimos</h6>
        <div className="table-responsive"><table className="table align-middle mb-0">
          <thead><tr><th>Produto</th><th>Usuário</th><th>Devolução</th><th>Retirada</th><th>Entrega</th><th>Status</th><th /></tr></thead>
          <tbody>
            {db.loans.length === 0 && <tr><td colSpan={7} className="text-muted">Nenhum empréstimo ainda.</td></tr>}
            {[...db.loans].reverse().map(l => (
              <tr key={l.id}>
                <td>{itemNome(db, l.itemId)}</td>
                <td>{l.nome}<div className="small text-muted">{l.contato}</div></td>
                <td>{fmt(l.devolucao)}</td>
                <td className="fw-bold">{l.codigo}</td>
                <td className="fw-bold">{l.codigoEntrega || l.codigo}</td>
                <td><Status s={l.status} /></td>
                <td className="text-end">{l.status === 'reservado' && <button className="btn btn-sm btn-outline-secondary" onClick={() => cancelar(l.id)}>Cancelar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div></div>
    </>
  )
}

// Permite ao administrador cadastrar e remover produtos do catálogo compartilhado.
// Lets administrators create products with an optional camera photo.
function Produtos({ db, toast }) {
  const [nome, setNome] = useState('')
  const [desc, setDesc] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [preparingPhoto, setPreparingPhoto] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadError, setUploadError] = useState('')

  // Creates a local preview and releases its temporary URL when the selection changes.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview('')
      return undefined
    }
    const preview = URL.createObjectURL(photoFile)
    setPhotoPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [photoFile])

  // Uploads the optional photo before saving the product document.
  async function add(event) {
    event.preventDefault()
    if (!nome.trim()) return toast('Informe o nome do produto.')

    const id = uid()
    setUploading(true)
    setUploadProgress(0)
    setPreparingPhoto(Boolean(photoFile))
    setUploadStatus(photoFile ? 'Preparando foto...' : '')
    setUploadError('')
    let photo
    try {
      photo = photoFile
        ? await uploadProductPhoto(photoFile, id, (progress, _transferred, _total, phase) => {
          setPreparingPhoto(phase === 'preparing')
          setUploadProgress(progress)
          setUploadStatus(phase === 'preparing'
            ? 'Otimizando foto...'
            : phase === 'saving'
              ? 'Salvando foto...'
              : `Preparando foto${progress ? `: ${progress}%` : '...'}`)
        })
        : {}
      setUploadStatus('Salvando produto...')
      await saveProduct({ id, nome: nome.trim(), desc: desc.trim(), ...photo })
      setNome('')
      setDesc('')
      setPhotoFile(null)
      toast('Produto cadastrado.')
    } catch (error) {
      setUploadError(error.message || 'Não foi possível enviar a foto do produto.')
    } finally {
      setUploading(false)
      setPreparingPhoto(false)
      setUploadStatus('')
    }
  }

  // Prevents deletion while a product is tied to an active loan.
  async function remove(id) {
    if (!itemLivre(db, id)) return toast('Não é possível remover um produto com empréstimo em andamento.')
    if (!window.confirm('Remover este produto?')) return

    try {
      await deleteProduct(id)
      toast('Produto removido.')
    } catch (error) {
      const message = error.code === 'permission-denied'
        ? 'O Firebase negou a remoção. Confirme se seu perfil está como administrador e publique as regras do Firestore.'
        : `Não foi possível remover o produto: ${error.message}`
      toast(message)
    }
  }

  return (
    <>
      <form className="card shadow-sm mb-3" onSubmit={add}>
        <div className="card-body">
          <h6>Cadastrar produto</h6>
          <div className="row g-2">
            <div className="col-md-4">
              <input className="form-control" placeholder="Nome" value={nome} onChange={event => setNome(event.target.value)} required />
            </div>
            <div className="col-md-5">
              <input className="form-control" placeholder="Descricao (opcional)" value={desc} onChange={event => setDesc(event.target.value)} />
            </div>
            <div className="col-md-3">
              <input
                key={photoFile ? photoFile.name : 'empty-photo'}
                className="form-control"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Tirar ou escolher foto do produto"
                onChange={event => setPhotoFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="col-12 d-flex align-items-center gap-3 flex-wrap">
              {photoPreview && <img className="product-photo-thumb" src={photoPreview} alt="Previa da foto do produto" />}
              <button className="btn btn-dark" disabled={uploading}>
                {uploading ? uploadStatus : 'Adicionar produto'}
              </button>
              <small className="text-muted">PNG, JPEG, WebP e outros formatos de imagem de até 20 MB. A foto é otimizada e salva com o produto no banco. No celular, use a câmera para fotografar.</small>
              {uploadError && <div className="alert alert-danger w-100 mb-0" role="alert">{uploadError}</div>}
              {uploading && photoFile && !preparingPhoto && (
                <div
                  className="progress w-100"
                  role="progressbar"
                  aria-label="Progresso do envio da foto"
                  aria-valuenow={uploadProgress}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuetext={uploadStatus}
                >
                  <div
                    className={`progress-bar ${uploadProgress ? '' : 'progress-bar-striped progress-bar-animated'}`}
                    style={{ width: `${uploadProgress || 35}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </form>

      <div className="card shadow-sm">
        <ul className="list-group list-group-flush">
          {db.items.length === 0 && <li className="list-group-item text-muted">Nenhum produto cadastrado.</li>}
          {db.items.map(item => (
            <li key={item.id} className="list-group-item d-flex justify-content-between align-items-center gap-3">
              <span className="d-flex align-items-center">
                {item.photoUrl && <img className="product-photo-thumb" src={item.photoUrl} alt={`Foto de ${item.nome}`} />}
                <span><strong>{item.nome}</strong> <span className="text-muted small">{item.desc}</span></span>
              </span>
              <span className="text-nowrap">
                <span className={`badge me-2 text-bg-${itemLivre(db, item.id) ? 'success' : 'secondary'}`}>
                  {itemLivre(db, item.id) ? 'Disponivel' : 'Emprestado'}
                </span>
                <button className="btn btn-sm btn-outline-danger" onClick={() => remove(item.id)}>Remover</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
// Lista os perfis e explica como promover um administrador usando o Firebase Console.
function Usuarios({ db, toast }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Copia o UID para facilitar a localização do perfil no Firebase Console.
  async function copiarUid(uid) {
    try {
      await navigator.clipboard.writeText(uid)
      toast('UID copiado.')
    } catch {
      toast('Não foi possível copiar. Selecione o UID manualmente.')
    }
  }

  function produtosDoUsuario(account) {
    return db.loans
      .filter(loan => {
        if (loan.userId && loan.userId === account.id) return true
        return !loan.userId && String(loan.contato || '').toLowerCase() === String(account.contato || '').toLowerCase()
      })
      .map(loan => {
        const produto = db.items.find(item => item.id === loan.itemId)
        return {
          ...loan,
          nomeProduto: itemNome(db, loan.itemId),
          fotoProduto: produto?.photoUrl || '',
        }
      })
      .reverse()
  }

  return (
    <>
      <div className="alert alert-info">
        <strong>Administradores são definidos pelo Firebase.</strong>
        <ol className="mb-0 mt-2">
          <li>Cadastre a conta pelo site com e-mail/senha ou Google, se ela ainda não existir.</li>
          <li>No Firebase Console → Authentication → Users, copie o UID dessa conta.</li>
          <li>No Firestore Database → <code>users</code>, abra o documento com esse UID e altere <code>role</code> para <code>admin</code>.</li>
        </ol>
        <span className="small">O cadastro pelo site cria o perfil automaticamente. A promoção para administrador continua sendo feita somente no Firebase.</span>
      </div>
      <div className="card shadow-sm"><div className="card-body">
        <h6>Contas cadastradas ({db.users.length})</h6>
        <div className="table-responsive"><table className="table align-middle mb-0">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Produtos</th><th>UID</th></tr></thead>
          <tbody>
            {db.users.map(account => {
              const produtos = produtosDoUsuario(account)
              return (
                <tr key={account.id}>
                  <td>{account.nome}</td>
                  <td>{account.contato}</td>
                  <td><span className={`badge text-bg-${account.role === 'admin' ? 'dark' : 'secondary'}`}>
                    {account.role === 'admin' ? 'administrador' : 'usuário'}
                  </span></td>
                  <td>
                    {produtos.length === 0 ? <span className="text-muted">Nenhum</span> : (
                      <ul className="mb-0 ps-0 small" style={{ listStyle: 'none' }}>
                        {produtos.map(loan => (
                          <li key={loan.id} className="mb-3">
                            <div className="d-flex align-items-center gap-2 mb-1">
                              {loan.fotoProduto && <img className="product-photo-thumb" src={loan.fotoProduto} alt={`Foto de ${loan.nomeProduto}`} />}
                              <span className="fw-semibold">{loan.nomeProduto}</span>
                              <span className="text-muted">({loan.status})</span>
                            </div>
                            <div className="text-muted">
                              Retirada: {loan.retirado ? fmtDataHora(loan.retirado) : '—'}
                            </div>
                            <div className="text-muted">
                              Entrega: {loan.devolvidoEm ? fmtDataHora(loan.devolvidoEm) : '—'}
                            </div>
                            <div className="text-muted">
                              Tempo: {tempoEmprestimo(loan.retirado, loan.devolvidoEm || (loan.status === 'emprestado' ? new Date() : null))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td><button className="btn btn-sm btn-outline-secondary" onClick={() => copiarUid(account.id)}>Copiar UID</button></td>
                </tr>
              )
            })}
            {db.users.length === 0 && <tr><td colSpan={5} className="text-muted">Nenhuma conta carregada.</td></tr>}
          </tbody>
        </table></div>
      </div></div>
    </>
  )
}
// Gerencia os prazos globais e a permissão de notificações deste navegador.
function Config({ db, update, toast }) {
  const [dias, setDias] = useState(db.cfg.diasAviso)
  const [max, setMax] = useState(db.cfg.maxDias)
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'indisponível')

  // Valida as preferências e grava os novos valores compartilhados no Firestore.
  function salvar() {
    const aviso = Number.parseInt(dias, 10)
    const prazo = Number.parseInt(max, 10)
    if (Number.isNaN(aviso) || aviso < 0 || Number.isNaN(prazo) || prazo < 1) {
      return toast('Informe prazos válidos.')
    }
    update(data => {
      data.cfg.diasAviso = aviso
      data.cfg.maxDias = prazo
    })
    toast('Configurações salvas.')
  }

  // Solicita ao navegador a permissão para mostrar lembretes locais.
  function ativarNotificacoes() {
    Notification.requestPermission().then(setPerm)
  }

  return (
    <div className="card shadow-sm"><div className="card-body">
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label" htmlFor="notice-days">Avisar quantos dias antes da devolução</label>
          <input id="notice-days" type="number" min="0" max="30" className="form-control" value={dias} onChange={event => setDias(event.target.value)} />
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="max-days">Prazo máximo de empréstimo (dias)</label>
          <input id="max-days" type="number" min="1" max="365" className="form-control" value={max} onChange={event => setMax(event.target.value)} />
        </div>
      </div>
      <button className="btn btn-dark mt-3" onClick={salvar}>Salvar configurações</button>
      <hr />
      <div className="d-flex align-items-center gap-3 flex-wrap">
        <span>Notificação do navegador: <strong>{perm}</strong></span>
        {'Notification' in window && (
          <button className="btn btn-sm btn-outline-secondary" onClick={ativarNotificacoes}>
            Ativar notificações
          </button>
        )}
      </div>
    </div></div>
  )
}

