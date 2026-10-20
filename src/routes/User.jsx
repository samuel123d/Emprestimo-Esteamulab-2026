import { useEffect, useState } from 'react'
import { today, addDaysTo, diff, diffFrom, fmt, fmtDataHora, itemNome, inicioDisponivelItem, periodoAtualItem, periodosItem, normContato, quando, Status, tempoEmprestimo, tempoRestante, correspondeBusca } from '../utils/lib.jsx'
import { createLoanReservation } from '../services/dataService.js'
import SearchBar from '../components/SearchBar.jsx'
import LoadingState from '../components/LoadingState.jsx'

// Formulário que permite escolher um produto e registrar um pedido de empréstimo.
export function Pedir({ db, toast, user }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sel, setSel] = useState(null)
  const [inicio, setInicio] = useState(today())
  const [data, setData] = useState('')
  const [criado, setCriado] = useState(null)
  const [salvando, setSalvando] = useState(false)

  // Valida o período solicitado; o servidor confere conflitos de forma transacional.
  async function pedir() {
    if (!sel) return toast('Escolha um produto.')
    if (!inicio || !data) return toast('Escolha as datas de início e devolução.')
    if (inicio < inicioDisponivelItem(db, sel)) {
      return toast(`Este produto pode ser reservado a partir de ${fmt(inicioDisponivelItem(db, sel))}.`)
    }
    const duracao = diffFrom(inicio, data)
    if (duracao < 1 || duracao > db.cfg.maxDias) {
      return toast(`A devolução deve ocorrer entre 1 e ${db.cfg.maxDias} dias após o início.`)
    }

    setSalvando(true)
    try {
      const loan = await createLoanReservation({ itemId: sel, inicio, devolucao: data, user })
      setCriado(loan)
      setSel(null)
      setData('')
    } catch (error) {
      if (error.code === 'reservation-conflict') {
        toast('Esse período acabou de ser reservado. Escolha outras datas.')
      } else {
        toast(`Não foi possível criar a reserva: ${error.message}`)
      }
    } finally {
      setSalvando(false)
    }
  }

  if (criado) return (
    <div className="card shadow-sm text-center"><div className="card-body py-5">
      <h5>Reserva registrada</h5>
      <p className="text-muted mb-1">{itemNome(db, criado.itemId)} · de {fmt(criado.inicio)} até {fmt(criado.devolucao)}</p>
      <p className="small text-muted">Reservado em {fmt(criado.criado) || '—'}</p>
      <div className="my-3">
        <div className="small text-muted">Código de retirada</div>
        <div className="code">{criado.codigo}</div>
      </div>
      <div className="my-3">
        <div className="small text-muted">Código de entrega</div>
        <div className="code">{criado.codigoEntrega}</div>
      </div>
      <p>Apresente os códigos ao administrador nas datas da reserva.<br />Você pode consultá-los depois em "Meus empréstimos".</p>
      <button className="btn btn-dark" onClick={() => setCriado(null)}>Novo pedido</button>
    </div></div>
  )

  return (
    <>
      <SearchBar
        id="user-product-search"
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Buscar produto pelo nome..."
        suggestions={db.items.map(item => item.nome)}
      />
      <div className="card shadow-sm mb-4"><div className="card-body">
        <h5 className="mb-3">1. Escolha o produto</h5>
        <div className="row g-3">
          {!db.ready?.items && <div className="col-12"><LoadingState label="Carregando produtos..." /></div>}
          {db.ready?.items && db.items.length === 0 && <p className="text-muted">Nenhum produto cadastrado ainda. Peça ao administrador para cadastrar.</p>}
          {db.items.filter(item => correspondeBusca(searchTerm, item.nome)).map(i => {
            const periodo = periodoAtualItem(db, i.id)
            const periodos = periodosItem(db, i.id)
            const proximaReserva = periodos.find(item => item.inicio > today())
            const inicioMinimo = inicioDisponivelItem(db, i.id)
            const disponibilidadeCarregada = db.ready?.availability && db.availability?.some(item => item.id === i.id)
            return (
              <div className="col-6 col-md-4" key={i.id}>
                <button
                  type="button"
                  className={`card item-card h-100 w-100 text-start ${sel === i.id ? 'sel' : ''} ${disponibilidadeCarregada ? '' : 'off'}`}
                  disabled={!disponibilidadeCarregada}
                  onClick={() => {
                    setSel(i.id)
                    setInicio(inicioMinimo)
                    setData('')
                  }}
                >
                  {i.photoUrl && <img className="product-photo" src={i.photoUrl} alt={`Foto de ${i.nome}`} />}
                  <div className="card-body">
                    <div className="fw-semibold">{i.nome}</div>
                    <span className={`badge mt-2 text-bg-${!disponibilidadeCarregada || periodo ? 'secondary' : 'success'}`}>
                      {!disponibilidadeCarregada ? 'Sincronizando' : periodo?.status === 'emprestado' ? 'Emprestado' : periodo ? 'Reservado' : 'Disponível'}
                    </span>
                    {periodo && <div className="small text-muted mt-1">Retorno previsto: {fmt(periodo.devolucao)}</div>}
                    {!periodo && proximaReserva && (
                      <div className="small text-muted mt-1">
                        Reservado de {fmt(proximaReserva.inicio)} até {fmt(proximaReserva.devolucao)}
                      </div>
                    )}
                    {periodos.length > 0 && (
                      <div className="small fw-semibold mt-1">Próxima reserva: {fmt(inicioMinimo)}</div>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
          {db.items.length > 0 && !db.items.some(item => correspondeBusca(searchTerm, item.nome)) && (
            <p className="text-muted mb-0">Nenhum produto corresponde à busca.</p>
          )}
        </div>
      </div></div>

      <div className="card shadow-sm"><div className="card-body">
        <h5 className="mb-3">2. Escolha o período da reserva</h5>
        <p className="text-muted small">Empréstimo em nome de {user.nome} ({user.contato}).</p>
        <div className="row g-3" style={{ maxWidth: 560 }}>
          <div className="col-sm-6">
            <label className="form-label" htmlFor="reservation-start">Início</label>
            <input
              id="reservation-start"
              type="date"
              className="form-control"
              value={inicio}
              min={sel ? inicioDisponivelItem(db, sel) : today()}
              onChange={event => {
                setInicio(event.target.value)
                if (data && (data <= event.target.value || diffFrom(event.target.value, data) > db.cfg.maxDias)) setData('')
              }}
            />
          </div>
          <div className="col-sm-6">
            <label className="form-label" htmlFor="reservation-return">Devolução</label>
            <input
              id="reservation-return"
              type="date"
              className="form-control"
              value={data}
              min={addDaysTo(inicio, 1)}
              max={addDaysTo(inicio, db.cfg.maxDias)}
              onChange={event => setData(event.target.value)}
            />
          </div>
          <div className="col-12"><div className="form-text">Prazo máximo de {db.cfg.maxDias} dias a partir do início. Produtos ocupados podem ser reservados para depois do retorno previsto. Se um produto aparecer como “Sincronizando”, peça ao administrador para abrir o painel primeiro.</div></div>
        </div>
        <button className="btn btn-dark mt-3" data-tooltip="Registrar sua reserva" disabled={salvando} onClick={pedir}>
          {salvando ? 'Registrando...' : 'Confirmar reserva'}
        </button>
      </div></div>
    </>
  )
}

// Mostra ao usuário o histórico e o andamento dos próprios empréstimos.
export function Meus({ db, user, toast }) {
  const [searchTerm, setSearchTerm] = useState('')
  const allLoans = db.loans.filter(l => l.userId === user.id || (!l.userId && normContato(l.contato) === user.contato)).reverse()
  const ls = allLoans.filter(loan => correspondeBusca(
    searchTerm,
    itemNome(db, loan.itemId),
    loan.status,
    loan.criado,
    loan.inicio,
    loan.devolucao,
    loan.retirado,
    loan.devolvidoEm,
    loan.codigo,
    loan.codigoEntrega,
  ))
  const atrasados = allLoans.filter(l => l.status === 'emprestado' && diff(l.devolucao) < 0)
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
      <SearchBar
        id="user-loan-search"
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Buscar meus empréstimos por produto, status, data ou código..."
        suggestions={allLoans.flatMap(loan => [
          itemNome(db, loan.itemId),
          loan.status,
          loan.criado,
          loan.inicio,
          loan.devolucao,
          loan.codigo,
          loan.codigoEntrega,
        ])}
      />
      {db.ready?.loans && atrasados.length > 0 && (
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
        {!db.ready?.loans && <LoadingState label="Carregando seus empréstimos..." />}
        {db.ready?.loans && ls.length === 0 && <p className="text-muted mb-0">{allLoans.length === 0 ? 'Você ainda não fez nenhum empréstimo.' : 'Nenhum empréstimo corresponde à busca.'}</p>}
        {db.ready?.loans && ls.map(l => {
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
                    <div className="small text-muted">
                      Período: {fmt(l.inicio || l.criado)} a {fmt(l.devolucao)}
                    </div>
                    <div className="small text-muted">Reservado em: {fmt(l.criado) || '—'}</div>
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
