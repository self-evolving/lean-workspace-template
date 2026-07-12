const scriptId = "hypothesis-embed-script"

function loadHypothesis() {
  if (!document.querySelector(".js-hypothesis-config")) {
    return
  }

  if (document.getElementById(scriptId)) {
    return
  }

  const embedScript = document.createElement("script")
  embedScript.id = scriptId
  embedScript.src = "https://hypothes.is/embed.js"
  embedScript.async = true
  document.head.appendChild(embedScript)
}

document.addEventListener("nav", loadHypothesis)
