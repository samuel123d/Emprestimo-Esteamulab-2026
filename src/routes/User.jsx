import { useEffect, useState } from 'react'
import { today, addDays, diff, fmt, fmtDataHora, ativo, itemLivre, itemNome, normContato, quando, Status, tempoEmprestimo, tempoRestante } from '../utils/lib.jsx'
import { createLoan } from '../services/dataService.js'

// Formulário que permite escolher um produto e registrar um pedido de empréstimo.
export function Pedir({ db, toast, user }) {
  const [sel, setSel] = useState(null)
  const [data, setData] = useState('')
  const [criado, setCriado] = useState(null)
  const [enviando, setEnviando] = useState(false)

  // Valida disponibilidade e prazo antes de criar o pedido
  async function pedir() {
    if (!sel) return toast('Escolha um produto.')
    if (!data) return toast('Escolha a data de devolução.')
    if (data <= today() || diff(data) > db.cfg.maxDias) return toast('Data fora do período permitido.')
    if (!itemLivre(db, sel)) return toast('Este produto acabou de ser emprestado.')

    setEnviando(true)
    try {
      const result = await createLoan(sel, data)
      setCriado({ itemId: sel, devolucao: data, codigo: result.codigo, codigoEntrega: result.codigoEntrega })
      setSel(null); setData('')
    } catch (error) {
      const msg = error.code === 'functions/already-exists'
        ? 'Este produto já possui um empréstimo ativo.'
        : error.message || 'Não foi possível registrar o empréstimo.'
      toast(msg)
    } finally {
      setEnviando(false)
    }
  }

  if (criado) return (
    <div className="card shadow-sm text-center"><div className="card-body py-5">
      <h5>Empréstimo registrado</h5>
      <p className="text-muted mb-1">{itemNome(db, criado.itemId)} · devolver até {fmt(criado.devolucao)}</p>
      <div className="my-3">
        <div className="small text-muted">Código de retirada</div>
        <div className="code">{criado.codigo}</div>
      </div>
      <div className="my-3">
        <div className="small text-muted">Código de entrega</div>
        <div className="code">{criado.codigoEntrega}</div>
      </div>
      <p>Apresente cada código ao administrador na etapa correspondente.<br />Você pode consultá-los depois em "Meus empréstimos".</p>
      <button className="btn btn-dark" onClick={() => setCriado(null)}>Novo pedido</button>
    </div></div>
  )

  return (
    <>
      <div className="card shadow-sm mb-4"><div className="card-body">
        <h5 className="mb-3">1. Escolha o produto</h5>
        <div className="row g-3">
          {db.items.length === 0 && <p className="text-muted">Nenhum produto cadastrado ainda. Peça ao administrador para cadastrar.</p>}
          {db.items.map(i => {
            const livre = itemLivre(db, i.id)
            return (
              <div className="col-6 col-md-4" key={i.id}>
                <div className={`card item-card h-100 ${sel === i.id ? 'sel' : ''} ${livre ? '' : 'off'}`} onClick={() => livre && setSel(i.id)}>
                  {i.photoUrl && <img className="product-photo" src={i.photoUrl} alt={`Foto de ${i.nome}`} />}
                  <div className="card-body">
                    <div className="fw-semibold">{i.nome}</div>
                    <div className="small text-muted">{i.desc}</div>
                    <span className={`badge mt-2 text-bg-${livre ? 'success' : 'secondary'}`}>{livre ? 'Disponível' : 'Emprestado'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div></div>

      <div className="card shadow-sm"><div className="card-body">
        <h5 className="mb-3">2. Defina a data de devolução</h5>
        <p className="text-muted small">Empréstimo em nome de {user.nome} ({user.contato}).</p>
        <div style={{ maxWidth: 260 }}>
          <label className="form-label">Devolver até</label>
          <input type="date" className="form-control" value={data} onChange={e => setData(e.target.value)} min={addDays(1)} max={addDays(db.cfg.maxDias)} />
          <div className="form-text">Máximo de {db.cfg.maxDias} dias.</div>
        </div>
        <button className="btn btn-dark mt-3" data-tooltip="Enviar seu pedido para registro" onClick={pedir} disabled={enviando}>{enviando ? 'Registrando...' : 'Confirmar empréstimo'}</button>
      </div></div>
    </>
  )
}

// Mostra ao usuário o histórico e o andamento dos próprios empréstimos.
export function Meus({ db, user, toast }) {
  const ls = db.loans.filter(l => l.userId === user.id || (!l.userId && normContato(l.contato) === user.contato)).reverse()
  const atrasados = ls.filter(l => l.status === 'emprestado' && diff(l.devolucao) < 0)
  const [codigoAberto, setCodigoAberto] = useState(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  async function abrirCodigo(loan, codigo, tipo) {
    try {
      await navigator.clipboard.writeText(codigo)
      setCodigoAberto(prev => prev === loan.id ? null : loan.id)
      toast(`Código de ${tipo} copiado. Apresente-o ao administrador.`)
    } catch {
      setCodigoAberto(prev => prev === loan.id ? null : loan.id)
      toast(`Código de ${tipo} exibido. Copie ou apresente-o ao administrador.`)
    }
  }

  return (
    <>
      {atrasados.length > 0 && (
        <aside className="overdue-penalty-notice alert alert-warning shadow" role="alert" aria-live="assertive">
          <strong>Aviso de penalidade</strong>
          <p className="mb-2">
            {atrasados.length === 1
              ? `A devolução de ${itemNome(db, atrasados[0].itemId)} está atrasada.`
              : `Você tem ${atrasados.length} devoluções atrasadas.`}
          </p>
          <p className="mb-0">
            Regularize a devolução com o administrador. Se o atraso acontecer novamente, o administrador poderá banir seu acesso.
          </p>
        </aside>
      )}
      <div className="card shadow-sm"><div className="card-body">
        <h5 className="mb-3">Meus empréstimos</h5>
        {ls.length === 0 && <p className="text-muted mb-0">Você ainda não fez nenhum empréstimo.</p>}
        {ls.map(l => {
          const d = diff(l.devolucao)
          const alerta = l.status === 'emprestado' && d <= db.cfg.diasAviso
          const codigoRetirada = l.codigo
          const codigoEntrega = l.codigoEntrega || l.codigo

          const produto = db.items.find(item => item.id === l.itemId)

          return (
            <div key={l.id} className={`border rounded p-3 mb-2 ${alerta ? 'border-warning bg-warning-subtle' : ''}`}>
              <div className="d-flex justify-content-between align-items-start gap-2">
                <div className="d-flex align-items-center gap-2">
                  {produto?.photoUrl && <img className="product-photo-thumb" src={produto.photoUrl} alt={`Foto de ${itemNome(db, l.itemId)}`} />}
                  <div>
                    <strong>{itemNome(db, l.itemId)}</strong>
                    <div className="small text-muted">Devolver até {fmt(l.devolucao)}</div>
                  </div>
                </div>
                <Status s={l.status} />
              </div>
              <div className="small text-muted mt-2">
                Retirada: {l.retirado ? fmtDataHora(l.retirado) : '—'}
              </div>
              <div className="small text-muted">
                Entrega: {l.devolvidoEm ? fmtDataHora(l.devolvidoEm) : '—'}
              </div>
              <div className="small text-muted">
                Tempo com o produto: {tempoEmprestimo(l.retirado, l.devolvidoEm || (l.status === 'emprestado' ? new Date() : null))}
              </div>
              {l.status === 'emprestado' && !alerta && (
                <div className="fw-semibold mt-1">
                  Tempo restante para entrega: {tempoRestante(l.devolucao)}
                </div>
              )}
              {alerta && <div className="fw-semibold mt-1">Atenção: a devolução {quando(d)}. Tempo restante para entrega: {tempoRestante(l.devolucao)}.</div>}
              {l.status === 'reservado' && (
                <div className="mt-2">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="small text-muted">Retirada</span>
                    <button className="btn btn-sm btn-dark" data-tooltip="Mostrar e copiar o código de retirada" onClick={() => abrirCodigo(l, codigoRetirada, 'retirada')}>Retirar</button>
                  </div>
                  {codigoAberto === l.id && <div className="fw-bold mt-1" style={{ letterSpacing: '.2rem' }}>{codigoRetirada}</div>}
                </div>
              )}
              {l.status === 'emprestado' && (
                <div className="mt-2">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="small text-muted">Entrega</span>
                    <button className="btn btn-sm btn-dark" data-tooltip="Mostrar e copiar o código de entrega" onClick={() => abrirCodigo(l, codigoEntrega, 'entrega')}>Entregar</button>
                  </div>
                  {codigoAberto === l.id && <div className="fw-bold mt-1" style={{ letterSpacing: '.2rem' }}>{codigoEntrega}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div></div>
    </>
  )
}
