import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { AuthFeedback } from "./components/auth-feedback";
import { BidderAuthProvider } from "./components/bidder-auth-provider";
import { SiteHeader } from "./components/site-header";

export const metadata: Metadata = {
  title: "New Horizons Auction",
  description:
    "Browse the New Horizons auction catalog. Register or sign in to your bidder account.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <BidderAuthProvider>
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <Suspense
            fallback={
              <header className="site-header" aria-hidden="true">
                <div className="site-header-inner">
                  <span className="brand">New Horizons Auction</span>
                </div>
              </header>
            }
          >
            <SiteHeader />
          </Suspense>
          <AuthFeedback />
          <div id="main-content">{children}</div>
        </BidderAuthProvider>
      </body>
    </html>
  );
}
