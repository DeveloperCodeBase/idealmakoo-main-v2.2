/** Explicit laboratory configuration; never change application behavior or
 * select a faster browser path by inspecting a Lighthouse user agent. */
export function auditBrowserConfiguration(options={}){
 if(options['swiftshader-driver']&&options['no-swiftshader'])throw new Error('--swiftshader-driver and --no-swiftshader are mutually exclusive.');
 const graphicsMode=options['swiftshader-driver']?'swiftshader-driver':options['no-swiftshader']?'browser-default':'webgl-software-fallback';
 const chromeFlags=['--headless=new','--disable-dev-shm-usage',...options['allow-root-chrome']?['--no-sandbox']:[],...options['no-swiftshader']?[]:['--enable-unsafe-swiftshader'],...options['swiftshader-driver']?['--use-gl=angle','--use-angle=swiftshader']:[]];
 return{chromeFlags,graphicsMode};
}
