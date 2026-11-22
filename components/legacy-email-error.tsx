"use client";
import { useEffect } from "react";
export default function LegacyEmailError() {
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has("error_code") || fragment.has("error"))
      location.replace("/auth/confirmation");
  }, []);
  return null;
}
