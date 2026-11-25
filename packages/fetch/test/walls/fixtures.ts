// Wall pages and store pages for the classifier tests. The wall pages are reduced from the shapes
// the Phase 0 transport lab saved on 2026-11-18 (lab/out/transport, not committed): every ray id,
// token, cookie value, reference number and hidden form value is replaced by a placeholder, and
// the styles are cut. The store pages are built for the negative tests.

export const CLOUDFLARE_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="robots" content="noindex,nofollow"><style>*{box-sizing:border-box;margin:0;padding:0}</style><meta http-equiv="refresh" content="360"></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div><script>(function(){window._cf_chl_opt = {cFPWv: 'b',cType: 'managed',cRay: 'RAY'};var a = document.createElement('script');a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=RAY';document.getElementsByTagName('head')[0].appendChild(a);}());</script></body></html>`;

export const CLOUDFLARE_HEADERS: readonly [string, string][] = [
  ['content-type', 'text/html; charset=UTF-8'],
  ['cf-mitigated', 'challenge'],
  ['cf-ray', 'RAY-YYZ'],
  ['server', 'cloudflare'],
];

/** DataDome's 403: an inline configuration whose `rt` says what the page is (i, c). */
export function datadomePage(rt: 'i' | 'c', host = 'shop.example'): string {
  return `<html lang="en"><head><title>${host}</title><style>#cmsg{animation: A 1.5s;}</style></head><body style="margin:0"><p id="cmsg">Please enable JS and disable any ad blocker</p><script data-cfasync="false">var dd={'rt':'${rt}','cid':'CID','hsh':'HSH','b':0,'s':0,'e':'E','qp':'','host':'geo.captcha-delivery.com','cookie':'COOKIE'}</script><script data-cfasync="false" src="https://ct.captcha-delivery.com/${rt}.js"></script></body></html>`;
}

export const DATADOME_HEADERS: readonly [string, string][] = [
  ['content-type', 'text/html;charset=utf-8'],
  ['x-datadome', 'protected'],
  ['x-dd-b', '1'],
];

export const AKAMAI_ACCESS_DENIED = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;shop&#46;example&#47;p&#47;1" on this server.<P>
Reference&#32;&#35;18&#46;0&#46;0&#46;0
<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;0&#46;0&#46;0</P>
</BODY>
</HTML>
`;

/** Amazon's "continue shopping" interstitial, served with 200 at the product URL. */
export const AMAZON_CONTINUE_SHOPPING = `<!DOCTYPE html>
<html class="a-no-js" lang="en-us"><head>
<meta charset="utf-8">
<title dir="ltr">Amazon.ca</title>
</head>
<body>
<!--
        To discuss automated access to Amazon data please contact the address Amazon gives.
-->
<div class="a-container">
  <div class="a-box a-alert a-alert-info"><div class="a-box-inner">
    <h4>Click the button below to continue shopping</h4>
  </div></div>
  <form method="get" action="/errors/validateCaptcha" name="">
    <input type="hidden" name="amzn" value="VALUE" /><input type="hidden" name="field-keywords" value="VALUE" />
    <span class="a-button a-button-primary"><button type="submit" class="a-button-text">Continue shopping</button></span>
  </form>
</div>
<div class="a-text-center">Conditions of Use Privacy Policy © 1996-2025, Amazon.com, Inc. or its affiliates</div>
</body></html>`;

/** Amazon's text captcha: an image and a box to type its characters into. */
export const AMAZON_TEXT_CAPTCHA = `<!DOCTYPE html><html><head><title dir="ltr">Amazon.ca</title></head><body>
<h4>Enter the characters you see below</h4>
<p>Sorry, we just need to make sure you're not a robot. For best results, please make sure your browser is accepting cookies.</p>
<form method="get" action="/errors/validateCaptcha"><img src="https://images-na.ssl-images-amazon.com/captcha/IMAGE.jpg">
<h4>Type the characters you see in this image:</h4><input type="text" id="captchacharacters" name="field-keywords">
<button type="submit">Continue shopping</button></form></body></html>`;

/** PerimeterX (HUMAN) at the end of Walmart's /blocked redirect. */
export const PERIMETERX_ROBOT_OR_HUMAN = `<html lang="en"><head><title>Robot or human?</title><style>#px-captcha{margin:0 auto}</style></head><body><div id="sign-in-widget"><h1>Robot or human?</h1><p>Activate and hold the button to confirm that you’re human. Thank You!</p><div id="px-captcha"></div><p>Having a problem? <a href="/help">Get help</a></p></div><script>window._pxAppId = 'APPID';</script><script src="/px/APPID/init.js"></script></body></html>`;

const FILLER =
  'Brushless motor, two speeds, 13 mm keyless chuck, LED work light, belt clip and a carry case. ';

/**
 * A store's product page of `paragraphs` description paragraphs, with `mention` as a customer
 * review and bot-manager strings in its scripts (DataDome's and PerimeterX's tags deployed on
 * the page, which is not a wall).
 */
export function productPage(options: {
  readonly title?: string;
  readonly mention?: string;
  readonly paragraphs?: number;
}): string {
  const { title = 'Cordless Drill | Example Tools', mention = '', paragraphs = 40 } = options;
  const description = Array.from({ length: paragraphs }, () => `<p>${FILLER}</p>`).join('\n');
  return `<!DOCTYPE html><html><head><title>${title}</title>
<script type="application/ld+json">{"@type":"Product","name":"Cordless Drill","offers":{"price":"129.00","priceCurrency":"CAD"}}</script>
<script src="https://js.captcha-delivery.com/tags.js"></script>
<script>var px = 'px-captcha'; var cfg = {"captcha":"https://geo.captcha-delivery.com/captcha/","error":"access denied","copy":"Just a moment..."};</script>
</head><body><header><nav><a href="/">Home</a> <a href="/tools">Tools</a></nav></header>
<main><h1>Cordless Drill</h1><span class="price">$129.00</span>
${description}
<section class="reviews"><h2>Reviews</h2><blockquote>${mention}</blockquote></section></main>
<footer>© Example Tools. Prices in CAD.</footer></body></html>`;
}
