export const cleanHtml = (html: string) => {
  // Remove <script>...</script> and <style>...</style> tags and their content
  let cleanedHtml = html
    .replace(/<script.*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style.*?>[\s\S]*?<\/style>/gi, "");

  // Remove <img> tags
  cleanedHtml = cleanedHtml.replace(/<img.*?>/gi, "");

  // Remove HTML comments
  cleanedHtml = cleanedHtml.replace(/<!--[\s\S]*?-->/g, "");

  // Remove all inline attributes
  cleanedHtml = cleanedHtml.replace(/<(\w+)([^>]*)>/g, "<$1>");

  // Remove header and footer
  cleanedHtml = cleanedHtml.replace(/<header.*?>[\s\S]*?<\/header>/gi, "");

  // Remove leading, trailing, and multiple internal whitespaces
  cleanedHtml = cleanedHtml.replace(/^\s+|\s+$|\s+(?=\s)/g, "");

  // Remove all html tags but keep content
  cleanedHtml = cleanedHtml.replace(/<[^>]*>/g, "");

  // remove all line breaks
  cleanedHtml = cleanedHtml.replace(/(\r\n|\n|\r)/gm, "");

  // remove all but one space between all words
  cleanedHtml = cleanedHtml.replace(/\s\s+/g, " ");

  return cleanedHtml;
};
