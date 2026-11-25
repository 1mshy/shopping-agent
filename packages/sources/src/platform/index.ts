// Platform JSON readers (S§5.2, the first rung of the reader ladder): each an `EndpointReader`
// that asks the platform's own public endpoint for one listing's price, before the page is
// fetched. Order, confirmed by spike C: Shopify, WooCommerce, Magento 2.
import type { EndpointReader } from '../read/contract.ts';
import { magentoReader } from './magento.ts';
import { shopifyReader } from './shopify.ts';
import { wooReader } from './woo.ts';

export {
  type MagentoFilter,
  type MagentoProductUrl,
  magentoQuery,
  magentoReader,
  magentoRequestUrl,
  parseMagentoProductUrl,
} from './magento.ts';
export { parseShopifyProductUrl, type ShopifyProductUrl, shopifyReader } from './shopify.ts';
export { parseWooProductUrl, WOO_STORE_API, type WooProductUrl, wooReader } from './woo.ts';

/**
 * The platform readers in ladder order. Stateless: one instance serves every read. At most one
 * applies to a store the directory names; on a store of unknown platform only Shopify applies (a
 * `/products/<handle>` path), so the ladder may try them in this order and stop at the first
 * that does not answer `not_applicable`.
 */
export const PLATFORM_READERS: readonly EndpointReader[] = [
  shopifyReader,
  wooReader,
  magentoReader,
];
