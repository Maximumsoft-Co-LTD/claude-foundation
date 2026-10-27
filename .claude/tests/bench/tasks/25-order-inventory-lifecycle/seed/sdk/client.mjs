export function createClient({ baseUrl, token }) {
  return {
    async legacyStock(sku) {
      const response = await fetch(`${baseUrl}/v1/stock/${encodeURIComponent(sku)}`);
      return response.json();
    }
  };
}
