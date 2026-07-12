import { FullSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const siteTitle = "Lean Workspace"
const repositoryUrl = "https://github.com/self-evolving/lean-workspace-template"

const PageTitle: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const home = resolveRelative(fileData.slug!, "index" as FullSlug)
  return (
    <h2 class={classNames(displayClass, "page-title")}>
      <a class="site-title-link" href={home} aria-label="Lean Workspace home">
        <span class="site-title-main" aria-hidden="true">
          <span class="site-title-variant site-title-variant-base">{siteTitle}</span>
          <span class="site-title-variant site-title-variant-hand">{siteTitle}</span>
          <span class="site-title-variant site-title-variant-bitcount">{siteTitle}</span>
          <span class="site-title-variant site-title-variant-dynapuff">{siteTitle}</span>
          <span class="site-title-variant site-title-variant-nabla">{siteTitle}</span>
          <span class="site-title-variant site-title-variant-code">{siteTitle}</span>
        </span>
      </a>
      <a
        class="page-title-github"
        href={repositoryUrl}
        aria-label="View the Lean Workspace repository on GitHub"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg
          class="page-title-github-icon"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.58c.68 0 1.36.09 2 .24 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      </a>
    </h2>
  )
}

PageTitle.css = `
.page-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 1.5rem;
  margin: 0;
  font-family: var(--titleFont);
}

.site-title-link {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 0.38rem;
  padding-left: 0.15rem;
  color: var(--dark);
  text-decoration: none;
}

.site-title-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--secondary) 35%, transparent);
  outline-offset: 4px;
  border-radius: 8px;
}

.site-title-main {
  display: inline-grid;
  align-items: center;
  color: var(--dark);
  white-space: nowrap;
}

.site-title-variant {
  grid-area: 1 / 1;
  display: block;
  color: var(--dark);
  line-height: 1;
  transform-origin: left center;
  transition: color 0.15s ease;
  white-space: nowrap;
}

.site-title-variant-base {
  font-family: var(--titleFont);
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: -0.055em;
  animation: site-title-evolve-base 24s ease-in-out infinite;
}

.site-title-variant-hand {
  font-family: "Caveat", cursive;
  font-size: 1.24rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  opacity: 0;
  animation: site-title-evolve-hand 24s ease-in-out infinite;
}

.site-title-variant-bitcount {
  font-family: "Bitcount Ink", var(--codeFont);
  font-size: 0.82rem;
  font-weight: 400;
  letter-spacing: -0.01em;
  opacity: 0;
  animation: site-title-evolve-bitcount 24s ease-in-out infinite;
}

.site-title-variant-dynapuff {
  font-family: "DynaPuff", var(--titleFont);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.045em;
  opacity: 0;
  animation: site-title-evolve-dynapuff 24s ease-in-out infinite;
}

.site-title-variant-nabla {
  font-family: "Nabla", var(--titleFont);
  font-size: 0.9rem;
  font-weight: 400;
  letter-spacing: -0.055em;
  opacity: 0;
  filter: hue-rotate(185deg) saturate(0.92) brightness(0.96);
  animation: site-title-evolve-nabla 24s ease-in-out infinite;
}

.site-title-variant-code {
  font-family: var(--codeFont);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  opacity: 0;
  animation: site-title-evolve-code 24s ease-in-out infinite;
}

.site-title-link:hover .site-title-variant,
.site-title-link:focus-visible .site-title-variant {
  color: var(--secondary);
}

.page-title-github {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  color: var(--darkgray);
  text-decoration: none;
  border-radius: 999px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.page-title-github:hover,
.page-title-github:focus-visible {
  color: var(--secondary);
  background: color-mix(in srgb, var(--secondary) 10%, transparent);
}

.page-title-github:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--secondary) 35%, transparent);
  outline-offset: 3px;
}

.page-title-github-icon {
  display: block;
  width: 1.08rem;
  height: 1.08rem;
  fill: currentColor;
}

@keyframes site-title-evolve-base {
  0%,
  18%,
  92%,
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  24%,
  86% {
    opacity: 0;
    transform: translateY(0.02rem) scale(0.99);
  }
}

@keyframes site-title-evolve-hand {
  0%,
  20%,
  38%,
  100% {
    opacity: 0;
    transform: translateY(0.04rem) scale(0.99);
  }

  25%,
  33% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes site-title-evolve-bitcount {
  0%,
  35%,
  53%,
  100% {
    opacity: 0;
    transform: translateY(-0.01rem) scale(0.99);
  }

  40%,
  48% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes site-title-evolve-dynapuff {
  0%,
  50%,
  68%,
  100% {
    opacity: 0;
    transform: translateY(0.02rem) scale(0.99);
  }

  55%,
  63% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes site-title-evolve-nabla {
  0%,
  65%,
  78%,
  100% {
    opacity: 0;
    transform: translateY(0.01rem) scale(0.98);
  }

  70%,
  74% {
    opacity: 0.9;
    transform: translateY(0) scale(1);
  }
}

@keyframes site-title-evolve-code {
  0%,
  75%,
  92%,
  100% {
    opacity: 0;
    transform: translateY(-0.02rem) scale(0.99);
  }

  80%,
  88% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-title-variant-base,
  .site-title-variant-hand,
  .site-title-variant-bitcount,
  .site-title-variant-dynapuff,
  .site-title-variant-nabla,
  .site-title-variant-code {
    animation: none;
  }

  .site-title-variant-base {
    opacity: 1;
    transform: none;
  }

  .site-title-variant-hand,
  .site-title-variant-bitcount,
  .site-title-variant-dynapuff,
  .site-title-variant-nabla,
  .site-title-variant-code {
    opacity: 0;
  }
}

`

export default (() => PageTitle) satisfies QuartzComponentConstructor
