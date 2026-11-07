import type { GoogleAdsClient } from "../http.js";
import { search } from "../gaql.js";

export interface AccessibleCustomer {
  id: string;
  resourceName: string;
  name?: string;
  currencyCode?: string;
  timeZone?: string;
  /** True for manager (MCC) accounts, which hold no ads of their own. */
  manager?: boolean;
  testAccount?: boolean;
  /** Set when the account is reachable but its details could not be read. */
  note?: string;
}

/**
 * Every customer the authenticated user can reach. This is the first call worth
 * making after `auth login`: it proves the OAuth client, the Cloud project's
 * API access, and the account linkage all work together.
 */
export async function listAccessibleCustomers(client: GoogleAdsClient): Promise<AccessibleCustomer[]> {
  const res = await client.request<{ resourceNames?: string[] }>({
    method: "GET",
    path: "/customers:listAccessibleCustomers",
    isRead: true,
  });
  const resourceNames = res.resourceNames ?? [];

  return Promise.all(
    resourceNames.map(async (resourceName): Promise<AccessibleCustomer> => {
      const id = resourceName.split("/").pop()!;
      try {
        const rows = await search(
          client,
          id,
          "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1",
        );
        const c = rows[0]?.customer;
        return {
          id,
          resourceName,
          name: c?.descriptiveName,
          currencyCode: c?.currencyCode,
          timeZone: c?.timeZone,
          manager: c?.manager,
          testAccount: c?.testAccount,
        };
      } catch (e) {
        // A manager account often cannot be queried without login-customer-id
        // pointed at itself. Listing it is still useful, so degrade rather than fail.
        return { id, resourceName, note: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/**
 * Client accounts under a manager. Useful for finding the right customer id
 * when the login account is an MCC.
 */
export async function listClientAccounts(client: GoogleAdsClient, managerId: string) {
  const rows = await search(
    client,
    managerId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
            customer_client.level, customer_client.currency_code, customer_client.status
     FROM customer_client WHERE customer_client.status = 'ENABLED'`,
  );
  return rows.map((r) => ({
    id: String(r.customerClient?.id ?? ""),
    name: r.customerClient?.descriptiveName,
    manager: r.customerClient?.manager,
    level: r.customerClient?.level,
    currencyCode: r.customerClient?.currencyCode,
  }));
}
