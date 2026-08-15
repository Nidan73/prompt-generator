import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  createAdminToken,
  verifyPassword,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== "string" || !verifyPassword(password)) {
      return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
    }

    const token = await createAdminToken();

    const response = NextResponse.json({ success: true, token });

    // Set secure httpOnly cookie
    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Admin login error", error);
    return NextResponse.json({ error: "Authentication failed." }, { status: 500 });
  }
}
