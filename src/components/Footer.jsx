import { useState } from 'react'

function CollaboratorAvatar() {
  const [imageFailed, setImageFailed] = useState(false)
  if (imageFailed) return <span className="collaborator-avatar" aria-hidden="true">BF</span>
  return (
    <img
      className="collaborator-avatar collaborator-avatar-image"
      src="https://avatars.githubusercontent.com/u/155818528?v=4"
      alt="Foto de perfil de BrunnoFOS"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  )
}

export default function Footer({ profile }) {
  return (
    <>
      {profile && (
        <footer className="site-partners">
          <div className="institutional-label">REALIZAÇÃO E PARCERIA</div>
          <div className="institutional-logo-row">
            <img className="logo-ufrn" src="/logos/ufrn.png" alt="Universidade Federal do Rio Grande do Norte" />
            <img className="logo-giife" src="/logos/giife.png" alt="GIIfE" />
            <img className="logo-imd" src="/logos/imd.png" alt="Instituto Metrópole Digital" />
          </div>
        </footer>
      )}
      <footer className="site-footer">
        <div className="creator-credit-wrap">
          <a
            className="creator-credit collaborator-credit"
            href="https://github.com/samuel123d"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Samuel Anderson, criador do site, no GitHub"
          >
            <img src="/creator/samuel.webp" alt="Foto de Samuel Anderson" />
            <span><strong>Samuel Anderson</strong><small>Criador do site</small></span>
          </a>
          <a
            className="creator-credit collaborator-credit"
            href="https://github.com/BrunnoFOS"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Bruno Ferreira, tester do site, no GitHub"
          >
            <CollaboratorAvatar />
          <span><strong>Bruno Ferreira</strong><small>Tester do site</small></span>
          </a>
        </div>
        <span className="footer-copyright">© {new Date().getFullYear()} ESTEAMULAB · Direitos reservados ao <a href="https://www.instagram.com/esteamulab/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>ESTEAMULAB</a> e a <a className="footer-creator-trigger" href="https://samuel123d.github.io/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Samuel Anderson</a>.</span>
        <span className="footer-tagline">Um espaço para pensar, criar e inovar.</span>
      </footer>
    </>
  )
}
