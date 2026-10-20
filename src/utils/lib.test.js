import { describe, it, expect } from 'vitest'
import {
  ymd, today, addDays, diff, fmt, paraData, fmtDataHora,
  tempoEmprestimo, tempoRestante, ativo, itemLivre, itemNome,
  gerarCodigo, normContato, lembretes, quando, linkEmail, linkContato,
} from './lib.jsx'

describe('ymd', () => {
  it('formata data como YYYY-MM-DD', () => {
    expect(ymd(new Date(2025, 0, 5))).toBe('2025-01-05')
    expect(ymd(new Date(2025, 11, 25))).toBe('2025-12-25')
  })
})

describe('fmt', () => {
  it('converte YYYY-MM-DD para DD/MM/YYYY', () => {
    expect(fmt('2025-01-05')).toBe('05/01/2025')
  })
  it('retorna string vazia para valores falsy', () => {
    expect(fmt('')).toBe('')
    expect(fmt(null)).toBe('')
  })
})

describe('addDays', () => {
  it('retorna string no formato YYYY-MM-DD', () => {
    const result = addDays(7)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('diff', () => {
  it('retorna 0 para hoje', () => {
    expect(diff(today())).toBe(0)
  })
})

describe('paraData', () => {
  it('converte string YYYY-MM-DD em Date', () => {
    const d = paraData('2025-06-15')
    expect(d).toBeInstanceOf(Date)
    expect(d.getFullYear()).toBe(2025)
  })
  it('retorna null para valores falsy/inválidos', () => {
    expect(paraData(null)).toBeNull()
    expect(paraData('')).toBeNull()
    expect(paraData('not-a-date')).toBeNull()
  })
  it('repassa objetos Date diretamente', () => {
    const d = new Date()
    expect(paraData(d)).toBe(d)
  })
  it('converte objetos com toDate (Firebase Timestamp)', () => {
    const fake = { toDate: () => new Date(2025, 5, 1) }
    expect(paraData(fake).getFullYear()).toBe(2025)
  })
})

describe('fmtDataHora', () => {
  it('formata string de data como DD/MM/YYYY', () => {
    expect(fmtDataHora('2025-01-05')).toBe('05/01/2025')
  })
  it('retorna travessão para null', () => {
    expect(fmtDataHora(null)).toBe('—')
  })
})

describe('tempoEmprestimo', () => {
  it('calcula duração entre duas datas', () => {
    const result = tempoEmprestimo('2025-01-01', '2025-01-03')
    expect(result).toContain('2 dia(s)')
  })
  it('retorna travessão para datas ausentes', () => {
    expect(tempoEmprestimo(null, '2025-01-01')).toBe('—')
  })
})

describe('tempoRestante', () => {
  it('mostra tempo restante', () => {
    const agora = new Date('2025-06-10T12:00:00')
    const result = tempoRestante('2025-06-12', agora)
    expect(result).toMatch(/^Faltam/)
  })
  it('mostra atraso', () => {
    const agora = new Date('2025-06-15T12:00:00')
    const result = tempoRestante('2025-06-10', agora)
    expect(result).toMatch(/^Atrasado/)
  })
  it('retorna travessão para data ausente', () => {
    expect(tempoRestante(null)).toBe('—')
  })
})

describe('ativo', () => {
  it('verdadeiro para reservado/emprestado', () => {
    expect(ativo({ status: 'reservado' })).toBe(true)
    expect(ativo({ status: 'emprestado' })).toBe(true)
  })
  it('falso para devolvido/cancelado', () => {
    expect(ativo({ status: 'devolvido' })).toBe(false)
    expect(ativo({ status: 'cancelado' })).toBe(false)
  })
})

describe('itemLivre', () => {
  const db = {
    loans: [
      { itemId: 'a', status: 'emprestado' },
      { itemId: 'b', status: 'devolvido' },
    ],
  }
  it('falso quando item tem empréstimo ativo', () => {
    expect(itemLivre(db, 'a')).toBe(false)
  })
  it('verdadeiro quando item não tem empréstimo ativo', () => {
    expect(itemLivre(db, 'b')).toBe(true)
    expect(itemLivre(db, 'c')).toBe(true)
  })
})

describe('itemNome', () => {
  it('retorna o nome do item', () => {
    expect(itemNome({ items: [{ id: 'x', nome: 'Arduino' }] }, 'x')).toBe('Arduino')
  })
  it('retorna fallback para item inexistente', () => {
    expect(itemNome({ items: [] }, 'x')).toBe('(removido)')
  })
})

describe('gerarCodigo', () => {
  it('gera código de 6 caracteres do alfabeto permitido', () => {
    const code = gerarCodigo({ loans: [] })
    expect(code).toHaveLength(6)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  })
  it('evita códigos bloqueados', () => {
    const bloqueado = 'AAAAAA'
    for (let i = 0; i < 50; i++) {
      expect(gerarCodigo({ loans: [] }, [bloqueado])).not.toBe(bloqueado)
    }
  })
})

describe('normContato', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normContato('  Foo@Bar.COM  ')).toBe('foo@bar.com')
  })
})

describe('lembretes', () => {
  it('filtra empréstimos dentro da janela de aviso', () => {
    const db = {
      cfg: { diasAviso: 2 },
      loans: [
        { status: 'emprestado', devolucao: today() },
        { status: 'emprestado', devolucao: addDays(10) },
        { status: 'devolvido', devolucao: today() },
      ],
    }
    const result = lembretes(db)
    expect(result).toHaveLength(1)
    expect(result[0].dias).toBe(0)
  })
})

describe('quando', () => {
  it('atrasado', () => expect(quando(-3)).toContain('atrasado'))
  it('hoje', () => expect(quando(0)).toBe('vence hoje'))
  it('amanhã', () => expect(quando(1)).toBe('vence amanhã'))
  it('futuro', () => expect(quando(5)).toBe('vence em 5 dias'))
})

describe('linkEmail', () => {
  it('retorna mailto com parâmetros corretos', () => {
    const db = { items: [{ id: 'i1', nome: 'Kit' }] }
    const loan = { itemId: 'i1', nome: 'Ana', contato: 'ana@x.com', devolucao: '2025-06-20', codigo: 'ABC123' }
    const link = linkEmail(db, loan, new Date('2025-06-18T10:00:00'))
    expect(link).toMatch(/^mailto:ana@x\.com\?/)
    expect(link).toContain('subject=')
    expect(link).toContain('body=')
  })
})

describe('linkContato', () => {
  it('retorna URL do WhatsApp', () => {
    const db = { items: [{ id: 'i1', nome: 'Kit' }] }
    const loan = { itemId: 'i1', nome: 'Ana', contato: '5511999990000', devolucao: '2025-06-20', codigo: 'XYZ' }
    const link = linkContato(db, loan)
    expect(link).toMatch(/^https:\/\/wa\.me\/5511999990000\?text=/)
  })
})
