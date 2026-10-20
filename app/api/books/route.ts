import { NextResponse } from "next/server";
import { getBooks } from "@/lib/catalog";

export const runtime = "nodejs";

export async function GET() {
  const books = await getBooks();
  return NextResponse.json({ total: books.length, books });
}
