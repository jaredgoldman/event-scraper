// @ts-nocheck
import cheerio from "cheerio";

export const cleanHtml = (html: string): string => {
  // Load the HTML into cheerio
  const $ = (cheerio).load(html);

  // Remove <script>, <style>, and <svg> tags and their content
  $("script, style, svg").remove();

  // Remove comments
  $("*")
    .contents()
    .each(function () {
      if (this.type as string === "comment") {
        $(this).remove();
      }
    });

  // Remove empty elements, but preserve table structure
  $("*")
    .not("table, thead, tbody, tfoot, tr, th, td")
    .filter(function () {
      return $(this as any).text().trim() === "";
    })
    .remove();

  // Remove newlines from text but preserve table structure
  $("*")
    .not("table, thead, tbody, tfoot, tr, th, td")
    .each(function () {
      const text = $(this as any).text();
      $(this).text(text.replace(/\n/g, ""));
    });

  // Clean up specific attributes that are often unnecessary, but preserve table structure
  $("*")
    .not("table, thead, tbody, tfoot, tr, th, td")
    .removeAttr("style")
    .removeAttr("class")
    .removeAttr("id");

  // Extract the cleaned HTML
  const cleanedHtml = $.html();

  return cleanedHtml;
}
;
