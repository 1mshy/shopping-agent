// Tab reads the cases share, reduced from the predecessor's test pages
// (pricewatch/tests/test_browser_mode.py STORE, CLOUDFLARE, DATADOME and the render tests).
import type { PageContent } from '../contract.ts';

const SIBOOR = 'https://www.siboor.com/product/lamp-bar/';
const NONE = { headers: {}, markup: [] } as const;

function content(fields: Partial<PageContent> & Pick<PageContent, 'documentBytes'>): PageContent {
  const visibleText = fields.visibleText ?? '';
  return {
    finalUrl: SIBOOR,
    ...NONE,
    title: '',
    visibleText,
    visibleChars: visibleText.length,
    ...fields,
  };
}

const STORE_TEXT = `${'Daylight Disco on a Stick, 5V lamp bar for Voron printers. '.repeat(8)}$9.50`;

export const store = content({
  title: 'Voron Lamp Bar | Siboor',
  visibleText: STORE_TEXT,
  documentBytes: 581,
});
export const cloudflare = content({
  title: 'Just a moment...',
  markup: [{ in: 'element_id', value: 'challenge-running' }],
  documentBytes: 104,
});
/** The challenge page again, its markup changed while it works. */
export const cloudflareLater = content({
  title: 'Just a moment...',
  markup: [{ in: 'element_id', value: 'challenge-stage' }],
  documentBytes: 102,
});
export const datadomeCaptcha = content({
  title: 'shop.example',
  markup: [{ in: 'iframe_src', value: 'https://geo.captcha-delivery.com/captcha/' }],
  documentBytes: 144,
});
/** DataDome's inline configuration naming a captcha response ('rt':'c'), ids removed. */
export const datadomeCaptchaConfig = content({
  title: 'shop.example',
  markup: [{ in: 'inline_script', value: "var dd={'rt':'c'}" }],
  documentBytes: 97,
});
export const accessDenied = content({
  title: 'Access Denied',
  visibleText: 'Access Denied',
  documentBytes: 80,
});
export const pressAndHold = content({
  finalUrl: 'https://www.walmart.ca/blocked?url=abc',
  title: 'Access to this page has been denied',
  visibleText: 'Press & Hold to confirm you are a human (and not a bot).',
  markup: [{ in: 'element_id', value: 'px-captcha' }],
  documentBytes: 183,
});
export const accessDeniedTitleOnly = content({
  title: 'Access to this page has been denied',
  documentBytes: 89,
});
export const verifyYourIdentity = content({
  finalUrl: 'https://www.walmart.ca/blocked?url=abc',
  title: 'Verify Your Identity',
  documentBytes: 35,
});
export const amazonTextCaptcha = content({
  finalUrl: 'https://www.amazon.ca/dp/B0BKVY4WKT',
  visibleText: 'Enter the characters you see below',
  documentBytes: 47,
});
export const blank = content({ documentBytes: 26 });
export const loading = content({ visibleText: 'Loading', documentBytes: 33 });
export const notFound = content({ visibleText: 'Not found', documentBytes: 35 });
export const plain403 = content({ visibleText: 'x'.repeat(5000), documentBytes: 5000 });

/** The store's own maintenance page; `tick` is the countdown that changes its DOM. */
export function maintenance(tick: number): PageContent {
  return content({
    title: 'Down for maintenance',
    visibleText: `${'We are upgrading our store and will be back soon. '.repeat(6)}${tick}`,
    documentBytes: 375,
  });
}
