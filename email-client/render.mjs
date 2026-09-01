//Renders the templates in notifications.mjs into an HTML body and a plain-text
//alternative. Both come from the SAME source, so copy is never written twice and the
//two versions cannot drift.
//
//The markup a template may use, and nothing else:
//  *bold*         -> <strong>bold</strong>
//  [label](url)   -> a link
//  blank line     -> new paragraph
//  single newline -> line break within a paragraph (this is what keeps the signoff
//                    on two lines)

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const BOLD = /\*([^*\n]+)\*/g;

//Darkened from the site's brand green (#5B913A), which is only 3.8:1 against white and
//fails WCAG AA for body text. This is 5.1:1 and still reads as the same colour.
const LINK_COLOR = "#4A7A2E";
const BODY_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial," +
  "sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px;";
const PARAGRAPH_STYLE = "margin:0 0 16px;";

//Escaping happens FIRST, before any markup is expanded, so that an ampersand in a trip
//name or a query string becomes &amp; while the tags added afterwards stay intact.
function toHtml(source) {
  const paragraphs = escapeHtml(source.trim())
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .trim()
        .replace(LINK, `<a href="$2" style="color:${LINK_COLOR};">$1</a>`)
        .replace(BOLD, "<strong>$1</strong>")
        .replace(/\n/g, "<br>")
    )
    .map((block) => `  <p style="${PARAGRAPH_STYLE}">${block}</p>`)
    .join("\n");
  return `<div style="${BODY_STYLE}">\n${paragraphs}\n</div>`;
}

//The fallback keeps the URL visible, since a plain-text reader cannot follow a label
function toText(source) {
  return source.trim().replace(LINK, "$1 ($2)").replace(BOLD, "$1");
}

export function renderBody(source) {
  return { html: toHtml(source), text: toText(source) };
}
