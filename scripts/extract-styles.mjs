import fs from 'fs';
import path from 'path';

const filePath = 'src/ui/ui-demo.html';
let content = fs.readFileSync(filePath, 'utf8');

const styleMap = new Map(); // styleString -> className
let styleCounter = 1;
const newStyles = [];

// Regular expression to match HTML tags with a style attribute
// Matches: <tag ... style="..." ...>
const tagRegex = /<([a-z0-9-]+)(\s+[^>]*?style="[^"]*?"[^>]*?)>/gi;

let replacedContent = content.replace(tagRegex, (match, tagName, attributes) => {
  // Extract the style attribute value
  const styleMatch = attributes.match(/style="([^"]*?)"/i);
  if (!styleMatch) return match;

  const styleValue = styleMatch[1].trim();
  if (!styleValue) {
    // If empty style, just remove the style attribute
    return match.replace(/\s*style=""/gi, '');
  }

  // Get or create class name for this unique style declaration
  let className = styleMap.get(styleValue);
  if (!className) {
    className = `gen-style-${styleCounter++}`;
    styleMap.set(styleValue, className);
    newStyles.push(`  .${className} { ${styleValue} }`);
  }

  // Remove the style="..." attribute
  let newAttributes = attributes.replace(/\s*style="[^"]*?"/gi, '');

  // Check if class attribute already exists
  const classMatch = newAttributes.match(/class="([^"]*?)"/i);
  if (classMatch) {
    const existingClasses = classMatch[1];
    // Append the new class name
    newAttributes = newAttributes.replace(/class="([^"]*?)"/i, `class="${existingClasses} ${className}"`);
  } else {
    // Insert new class attribute
    newAttributes = `${newAttributes} class="${className}"`;
  }

  // Clean up any double spaces introduced
  newAttributes = newAttributes.replace(/\s+/g, ' ');

  return `<${tagName}${newAttributes}>`;
});

// Inject the generated classes into the existing <style> block
const styleBlockRegex = /(<style>)/i;
if (styleBlockRegex.test(replacedContent)) {
  const cssPayload = `\n  /* Generated Classes from Inline Styles */\n${newStyles.join('\n')}\n`;
  replacedContent = replacedContent.replace(styleBlockRegex, `$1${cssPayload}`);
  console.log(`Successfully extracted ${styleMap.size} unique styles into ${newStyles.length} CSS classes.`);
} else {
  console.error("Could not find <style> block in the HTML file.");
}

fs.writeFileSync(filePath, replacedContent, 'utf8');
console.log("ui-demo.html successfully updated!");
