/// <reference types="vite/client" />

// Raw imports handling for HTML and CSS files
declare module '*.html?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}
