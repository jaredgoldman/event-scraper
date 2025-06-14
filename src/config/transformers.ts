import { HtmlToTextTransformer } from '@langchain/community/document_transformers/html_to_text'

export const htmlToTextConfig = {
  wordwrap: false,
  preserveWhitespace: false,
  selectors: [
    { selector: 'h1', format: 'block' },
    { selector: 'h2', format: 'block' },
    { selector: 'h3', format: 'block' },
    { selector: 'h4', format: 'block' },
    { selector: 'h5', format: 'block' },
    { selector: 'h6', format: 'block' },
    { selector: 'time', format: 'block' },
    { selector: '.date', format: 'block' },
    { selector: '.time', format: 'block' },
    { selector: 'article', format: 'block' },
    { selector: 'section', format: 'block' },
    { selector: 'p', format: 'block' },
    { selector: 'div', format: 'block' },
    { selector: 'ul', format: 'block' },
    { selector: 'ol', format: 'block' },
    { selector: 'li', format: 'block' },
    { selector: 'a', format: 'inline' },
    { selector: 'span', format: 'inline' },
    { selector: 'strong', format: 'inline' },
    { selector: 'b', format: 'inline' },
    { selector: 'em', format: 'inline' },
    { selector: 'i', format: 'inline' },
    { selector: 'br', format: 'lineBreak' },
  ],
}

export const createHtmlToTextTransformer = () => {
  return new HtmlToTextTransformer(htmlToTextConfig)
}
