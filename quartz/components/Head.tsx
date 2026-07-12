import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"

const CustomOgImagesEmitterName = "CustomOgImages"

export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
  }: QuartzComponentProps) => {
    const frontmatter = fileData.frontmatter
    const isIndexPage = fileData.slug === "index" || fileData.slug === ""
    const titleSuffix = isIndexPage ? "" : (cfg.pageTitleSuffix ?? "")
    const pageTitle = frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title
    const title = pageTitle + titleSuffix
    const socialTitle =
      typeof frontmatter?.socialTitle === "string" ? frontmatter.socialTitle : pageTitle
    const description =
      frontmatter?.socialDescription ??
      frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const icon16Path = joinSegments(baseDir, "static/icon-16.png")
    const icon128Path = joinSegments(baseDir, "static/icon-128.png")
    const iconPath = joinSegments(baseDir, "static/icon.png")

    // Url of current page
    const socialUrl =
      fileData.slug === "404" ? url.toString() : joinSegments(url.toString(), fileData.slug!)

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some(
      (e) => e.name === CustomOgImagesEmitterName,
    )
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png`
    const redirect = frontmatter?.redirect
    const redirectUrl = typeof redirect === "string" && redirect.length > 0 ? redirect : undefined
    const canonicalRedirectUrl = redirectUrl ? new URL(redirectUrl, url).toString() : undefined

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bitcount+Ink&family=Caveat:wght@600;700&family=DynaPuff:wght@500;600;700&family=Nabla&display=swap"
        />
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <meta name="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:title" content={socialTitle} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={socialTitle} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta
              property="og:image:type"
              content={`image/${getFileExtension(ogImageDefaultPath) ?? "png"}`}
            />
          </>
        )}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={cfg.baseUrl}></meta>
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
          </>
        )}

        {redirectUrl && (
          <>
            <link rel="canonical" href={canonicalRedirectUrl} />
            <meta name="robots" content="noindex" />
            <meta httpEquiv="refresh" content={`0; url=${redirectUrl}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.location.replace(${JSON.stringify(redirectUrl)})`,
              }}
            />
          </>
        )}

        <link rel="icon" href={icon16Path} sizes="16x16" type="image/png" />
        <link rel="icon" href={icon128Path} sizes="128x128" type="image/png" />
        <link rel="icon" href={iconPath} type="image/png" />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />

        {css.map((resource) => CSSResourceToStyleElement(resource, true))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
      </head>
    )
  }

  return Head
}) satisfies QuartzComponentConstructor
