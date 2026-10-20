import { useEffect, useState } from 'react'
import { normalizarBusca } from '../utils/lib.jsx'

export default function SearchBar({ id, value, onChange, placeholder, suggestions = [] }) {
  const search = normalizarBusca(value).trim()
  const options = [...new Set(suggestions
    .filter(Boolean)
    .map(String)
    .filter(option => !search || normalizarBusca(option).includes(search)))]
    .slice(0, 8)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const showSuggestions = Boolean(search && options.length && !dismissed)

  useEffect(() => {
    setActiveIndex(-1)
  }, [value])

  function chooseSuggestion(option) {
    onChange(option)
    setActiveIndex(-1)
    setDismissed(true)
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && showSuggestions) {
      setDismissed(true)
      setActiveIndex(-1)
    } else if (event.key === 'ArrowDown' && showSuggestions) {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % options.length)
    } else if (event.key === 'ArrowUp' && showSuggestions) {
      event.preventDefault()
      setActiveIndex(index => (index <= 0 ? options.length - 1 : index - 1))
    } else if (event.key === 'Enter' && showSuggestions && activeIndex >= 0) {
      event.preventDefault()
      chooseSuggestion(options[activeIndex])
    }
  }

  function handleChange(event) {
    setDismissed(false)
    onChange(event.target.value)
  }

  return (
    <div className="area-search mb-3">
      <label className="visually-hidden" htmlFor={id}>Buscar nesta área</label>
      <div className="input-group">
        <span className="input-group-text" aria-hidden="true">⌕</span>
        <input
          id={id}
          type="search"
          className="form-control"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={`${id}-suggestions`}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button className="btn btn-outline-secondary" type="button" onClick={() => onChange('')}>
            Limpar
          </button>
        )}
      </div>
      {showSuggestions && (
        <ul id={`${id}-suggestions`} className="search-suggestions" role="listbox">
          {options.map((option, index) => (
            <li key={option} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={`search-suggestion${index === activeIndex ? ' active' : ''}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => chooseSuggestion(option)}
              >
                <span className="search-suggestion-icon" aria-hidden="true">⌕</span>
                <span>{option}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
