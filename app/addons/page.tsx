import { redirect } from "next/navigation";

// /addons virou /integracoes — mantém os links antigos funcionando (a query é preservada).
export default async function AddonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, item);
  }
  const qs = params.toString();
  redirect(`/integracoes${qs ? `?${qs}` : ""}`);
}
