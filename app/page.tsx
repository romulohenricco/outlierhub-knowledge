import { redirect } from "next/navigation";

/** A estante mora em /estante; a raiz só encaminha (a marca e os links antigos continuam valendo). */
export default function HomePage() {
  redirect("/estante");
}
