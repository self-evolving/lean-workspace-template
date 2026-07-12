import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { ChangedPage, previewChangedPages } from "./ChangedPageData"

function envValue(name: string) {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

type PreviewDeploymentInfo = {
  prNumber: string
  branch?: string
  repo: string
  repoUrl: string
  prUrl: string
}

export function previewDeploymentInfo(): PreviewDeploymentInfo | undefined {
  const prNumber = envValue("SEPO_PREVIEW_PR")
  if (!prNumber || !/^[1-9][0-9]*$/.test(prNumber)) return undefined

  const repo = envValue("GITHUB_REPOSITORY") ?? "self-evolving/lean-workspace-template"
  const repoUrl = `https://github.com/${repo}`

  return {
    prNumber,
    branch: envValue("SEPO_PREVIEW_BRANCH"),
    repo,
    repoUrl,
    prUrl: `${repoUrl}/pull/${prNumber}`,
  }
}

export function hasPreviewDeploymentBanner() {
  return previewDeploymentInfo() !== undefined
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function checkoutCommands(info: PreviewDeploymentInfo) {
  const repoDir = info.repo.split("/").at(-1) ?? "lean-workspace-template"
  const checkout = info.branch
    ? `git fetch origin ${shellQuote(info.branch)}\ngit checkout ${shellQuote(info.branch)}`
    : `git fetch origin pull/${info.prNumber}/head:preview-pr-${info.prNumber}\ngit checkout preview-pr-${info.prNumber}`

  return `git clone ${shellQuote(`${info.repoUrl}.git`)}\ncd ${shellQuote(repoDir)}\n${checkout}\nnpm ci\nnpm run build`
}

function changedPageHref(currentSlug: FullSlug | undefined, page: ChangedPage) {
  return currentSlug ? resolveRelative(currentSlug, page.slug) : page.slug
}

function previewBannerScript() {
  return `(() => {
  const globalKey = "__sepoPreviewBannerBound";
  if (window[globalKey]) return;
  window[globalKey] = true;

  const collapsedClass = "sepo-preview-banner-collapsed";
  let collapseTimer;

  const banner = () => document.querySelector(".sepo-preview-banner");
  const localModal = () => document.querySelector(".sepo-preview-local-modal");
  const changedPageMenus = () => Array.from(document.querySelectorAll(".sepo-preview-changed-pages"));
  const isLocalModalOpen = () => {
    const modal = localModal();
    return !!modal && !modal.hidden;
  };
  const isChangedPagesOpen = () => changedPageMenus().some((details) => details.open);

  const cssNumber = (name, fallback) => {
    const value = Number.parseFloat(getComputedStyle(document.body).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  const updateBannerHeight = () => {
    const currentBanner = banner();
    if (!currentBanner) return;
    currentBanner.classList.toggle("sepo-preview-changed-pages-open", isChangedPagesOpen());

    const inner = currentBanner.querySelector(".sepo-preview-banner-inner");
    const fullHeight = Math.max(
      inner?.getBoundingClientRect().height ?? 0,
      currentBanner.getBoundingClientRect().height
    );
    if (fullHeight <= 0) return;

    const collapsedHeight = cssNumber("--sepo-preview-banner-collapsed-height", 7);
    const collapsed =
      document.body.classList.contains(collapsedClass) &&
      !currentBanner.matches(":hover, :focus-within") &&
      !isChangedPagesOpen();
    const visibleHeight = collapsed ? collapsedHeight : fullHeight;

    if (fullHeight > 16) {
      document.documentElement.style.setProperty("--sepo-preview-banner-expanded-height", fullHeight + "px");
      document.body.style.setProperty("--sepo-preview-banner-expanded-height", fullHeight + "px");
    }
    document.documentElement.style.setProperty("--sepo-preview-banner-height", visibleHeight + "px");
    document.body.style.setProperty("--sepo-preview-banner-height", visibleHeight + "px");
  };

  const clearCollapseTimer = () => {
    if (collapseTimer) window.clearTimeout(collapseTimer);
    collapseTimer = undefined;
  };

  const setCollapsed = (collapsed) => {
    document.body.classList.toggle(collapsedClass, collapsed);
    updateBannerHeight();
    window.requestAnimationFrame(updateBannerHeight);
    window.setTimeout(updateBannerHeight, 520);
  };

  const expandBanner = () => {
    clearCollapseTimer();
    setCollapsed(false);
  };

  const scheduleCollapse = (delay = 4500) => {
    clearCollapseTimer();
    if (!banner() || isLocalModalOpen() || isChangedPagesOpen()) return;
    collapseTimer = window.setTimeout(() => setCollapsed(true), delay);
  };

  const bindBanner = () => {
    const currentBanner = banner();
    if (!currentBanner || currentBanner.dataset.sepoPreviewCollapseBound) return;
    currentBanner.dataset.sepoPreviewCollapseBound = "true";
    currentBanner.addEventListener("mouseenter", expandBanner);
    currentBanner.addEventListener("focusin", expandBanner);
    currentBanner.addEventListener("mouseleave", () => scheduleCollapse());
    currentBanner.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!currentBanner.matches(":focus-within")) scheduleCollapse();
      }, 0);
    });
    currentBanner.addEventListener("transitionend", updateBannerHeight);
    currentBanner.querySelectorAll(".sepo-preview-changed-pages").forEach((details) => {
      if (details.dataset.sepoPreviewChangedPagesBound) return;
      details.dataset.sepoPreviewChangedPagesBound = "true";
      details.addEventListener("toggle", () => {
        currentBanner.classList.toggle("sepo-preview-changed-pages-open", isChangedPagesOpen());
        if (details.open) {
          clearCollapseTimer();
          expandBanner();
        } else {
          scheduleCollapse();
        }
        updateBannerHeight();
        window.requestAnimationFrame(updateBannerHeight);
      });
    });
  };

  updateBannerHeight();
  bindBanner();
  scheduleCollapse();
  window.addEventListener("resize", () => {
    updateBannerHeight();
    scheduleCollapse();
  });
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(updateBannerHeight);
    const observe = () => {
      const currentBanner = banner();
      if (currentBanner) observer.observe(currentBanner);
    };
    observe();
    document.addEventListener("nav", observe);
  }
  document.addEventListener("nav", () => {
    bindBanner();
    updateBannerHeight();
    scheduleCollapse();
  });

  const closeLocalModal = () => {
    const modal = localModal();
    if (modal) modal.hidden = true;
    document.body.classList.remove("sepo-preview-modal-open");
    scheduleCollapse();
  };
  const closeChangedPages = () => {
    changedPageMenus().forEach((details) => {
      details.open = false;
    });
  };
  const openLocalModal = () => {
    const modal = localModal();
    if (!modal) return;
    expandBanner();
    modal.hidden = false;
    document.body.classList.add("sepo-preview-modal-open");
    modal.querySelector(".sepo-preview-local-close")?.focus();
  };
  document.addEventListener("nav", () => {
    closeChangedPages();
    closeLocalModal();
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".sepo-preview-changed-pages")) closeChangedPages();

    const localOpen = target?.closest("[data-sepo-preview-local-open]");
    if (localOpen) {
      event.preventDefault();
      openLocalModal();
      return;
    }

    if (target?.closest("[data-sepo-preview-local-close]")) {
      event.preventDefault();
      closeLocalModal();
      return;
    }

    const sepoOpen = target?.closest("[data-sepo-preview-open]");
    if (!sepoOpen) return;
    if (window.sepoComments && typeof window.sepoComments.open === "function") {
      event.preventDefault();
      expandBanner();
      window.sepoComments.open();
      scheduleCollapse();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeChangedPages();
      closeLocalModal();
    }
  });
})();`
}

export default (() => {
  const PreviewDeploymentBanner: QuartzComponent = (props: QuartzComponentProps) => {
    const info = previewDeploymentInfo()
    if (!info) return null

    const changedPages = previewChangedPages()
    const currentSlug =
      typeof props.fileData.slug === "string" ? (props.fileData.slug as FullSlug) : undefined

    return (
      <aside class="sepo-preview-banner" aria-label="Preview deployment notice">
        <div class="sepo-preview-banner-inner">
          <div class="sepo-preview-banner-copy">
            <span>
              You’re viewing a live preview of <a href={info.prUrl}>PR #{info.prNumber}</a>. You can
              talk to Sepo directly to answer questions or fix issues. For faster iteration, you can
              also run locally.
            </span>
          </div>
          <div class="sepo-preview-banner-actions" aria-label="Preview workflow actions">
            <a
              class="sepo-preview-banner-action"
              href={info.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-sepo-preview-open
            >
              Talk to Sepo
            </a>
            <button
              class="sepo-preview-banner-action sepo-preview-banner-action-secondary"
              type="button"
              data-sepo-preview-local-open
            >
              Run locally
            </button>
            {changedPages.length > 0 && (
              <details class="sepo-preview-changed-pages">
                <summary
                  class="sepo-preview-banner-action sepo-preview-banner-action-secondary sepo-preview-changed-pages-summary"
                  aria-label={`Show ${changedPages.length} changed page${
                    changedPages.length === 1 ? "" : "s"
                  }`}
                >
                  Changed ({changedPages.length})
                </summary>
                <ul class="sepo-preview-changed-pages-list">
                  {changedPages.map((page) => (
                    <li>
                      <a
                        class="sepo-preview-changed-page-link"
                        href={changedPageHref(currentSlug, page)}
                      >
                        <span class="sepo-preview-changed-page-source">{page.sourcePath}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
        <div
          class="sepo-preview-local-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sepo-preview-local-title"
          hidden
        >
          <button
            class="sepo-preview-local-backdrop"
            type="button"
            aria-label="Close local setup instructions"
            data-sepo-preview-local-close
          ></button>
          <div class="sepo-preview-local-panel">
            <button
              class="sepo-preview-local-close"
              type="button"
              aria-label="Close local setup instructions"
              data-sepo-preview-local-close
            >
              ×
            </button>
            <h2 id="sepo-preview-local-title">Run this preview locally</h2>
            <p>
              For faster iteration, clone the same branch, build it locally, and then ask your local
              coding agent to inspect or change it.
            </p>
            <pre>
              <code>{checkoutCommands(info)}</code>
            </pre>
            <p class="sepo-preview-local-note">
              After the build succeeds, run <code>npm run dev</code> if you want a local preview
              server while you iterate.
            </p>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: previewBannerScript() }} />
      </aside>
    )
  }

  return PreviewDeploymentBanner
}) satisfies QuartzComponentConstructor
