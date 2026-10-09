import { useState } from 'react'
import { today, addDays, diff, fmt, ativo, itemLivre, itemNome, gerarCodigo, uid, normContato, quando, Status } from '../utils/lib.jsx'

// Formulário que permite escolher um produto e registrar um pedido de empréstimo.
export function Pedir({ db, update, toast, user }) {
  const [sel, setSel] = useState(null)
  const [data, setData] = useState('')
  const [criado, setCriado] = useState(null)

  // Valida disponibilidade e prazo antes de criar o pedido no Firestore.
  function pedir() {
    if (!sel) return toast('Escolha um produto.')
    if (!data) return toast('Escolha a data de devolução.')
    if (data <= today() || diff(data) > db.cfg.maxDias) return toast('Data fora do período permitido.')
    if (!itemLivre(db, sel)) return toast('Este produto acabou de ser emprestado.')
    const l = { id: uid(), itemId: sel, userId: user.id, nome: user.nome, contato: user.contato, devolucao: data, codigo: gerarCodigo(db), status: 'reservado', criado: today() }
    update(d => { d.loans.push(l) })
    setCriado(l); setSel(null); setData('')
  }

  if (criado) return (
    <div className="card shadow-sm text-center"><div className="card-body py-5">
      <h5>Empréstimo registrado</h5>
      <p className="text-muted mb-1">{itemNome(db, criado.itemId)} · devolver até {fmt(criado.devolucao)}</p>
      <div className="code my-3">{criado.codigo}</div>
      <p>Apresente este código ao administrador para <strong>retirar</strong> e para <strong>devolver</strong> o produto.<br />Você pode consultá-lo depois em "Meus empréstimos".</p>
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
        <button className="btn btn-dark mt-3" onClick={pedir}>Confirmar empréstimo</button>
      </div></div>
    </>
  )
}

// Mostra ao usuário o histórico e o andamento dos próprios empréstimos.
export function Meus({ db, user }) {
  const ls = db.loans.filter(l => l.userId === user.id || (!l.userId && normContato(l.contato) === user.contato)).reverse()
  return (
    <div className="card shadow-sm"><div className="card-body">
      <h5 className="mb-3">Meus empréstimos</h5>
      {ls.length === 0 && <p className="text-muted mb-0">Você ainda não fez nenhum empréstimo.</p>}
      {ls.map(l => {
        const d = diff(l.devolucao)
        const alerta = l.status === 'emprestado' && d <= db.cfg.diasAviso
        return (
          <div key={l.id} className={`border rounded p-3 mb-2 ${alerta ? 'border-warning bg-warning-subtle' : ''}`}>
            <div className="d-flex justify-content-between"><strong>{itemNome(db, l.itemId)}</strong><Status s={l.status} /></div>
            <div className="small text-muted">Devolver até {fmt(l.devolucao)}</div>
            {alerta && <div className="fw-semibold mt-1">Atenção: a devolução {quando(d)}.</div>}
            {ativo(l) && <div className="mt-2">Seu código: <span className="fw-bold" style={{ letterSpacing: '.2rem' }}>{l.codigo}</span></div>}
          </div>
        )
      })}
    </div></div>
  )
}
