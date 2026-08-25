import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Verify from "./pages/Verify";
import Reset from "./pages/Reset";
import Index from "./pages/Index";
import Products from "./pages/Products";
import Listing from "./pages/Listing";
import Post from "./pages/Post";
import Messages from "./pages/Messages";
import MyListings from "./pages/MyListings";
import Favorites from "./pages/Favorites";
import Admin from "./pages/Admin";
import Seller from "./pages/Seller";
import Settings from "./pages/Settings";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import HowItWorks from "./pages/HowItWorks";
import Safety from "./pages/Safety";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

// Old .html paths → clean paths. The server 301-redirects these for hard
// navigations/refreshes; these client-side routes are a safety net for any
// in-app link still pointing at an old path (and for a stale cached bundle
// mid-deploy), preserving the query string so ?next=/?token= survive.
const LEGACY_PATHS: Record<string, string> = {
  "/index.html": "/",
  "/post.html": "/post",
  "/messages.html": "/messages",
  "/mylistings.html": "/mylistings",
  "/favorites.html": "/favorites",
  "/settings.html": "/settings",
  "/admin.html": "/admin",
  "/login.html": "/login",
  "/register.html": "/register",
  "/verify.html": "/verify",
  "/reset.html": "/reset",
  "/terms.html": "/terms",
  "/privacy.html": "/privacy",
  "/how-it-works.html": "/how-it-works",
  "/safety.html": "/safety",
  "/contact.html": "/contact",
};

function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

// /listing.html?id=123 → /listing/123 ; /seller.html?u=Name → /seller/Name
function LegacyListingRedirect() {
  const id = new URLSearchParams(useLocation().search).get("id");
  return <Navigate to={id ? `/listing/${id}` : "/"} replace />;
}

// A username in the path is the new form; the old ?u= query form still works.
function SellerRoute() {
  const { username } = useParams();
  const u = new URLSearchParams(useLocation().search).get("u");
  if (!username && u) return <Navigate to={`/seller/${encodeURIComponent(u)}`} replace />;
  return <Seller />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Index />} />
            <Route path="/products" element={<Products />} />
            <Route path="/listing/:id" element={<Listing />} />
            <Route path="/post" element={<Post />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/mylistings" element={<MyListings />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/seller/:username" element={<SellerRoute />} />
            <Route path="/seller" element={<SellerRoute />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/safety" element={<Safety />} />
            <Route path="/contact" element={<Contact />} />

            {/* Legacy .html paths (safety net; the server also 301s these) */}
            <Route path="/listing.html" element={<LegacyListingRedirect />} />
            <Route path="/seller.html" element={<SellerRoute />} />
            {Object.entries(LEGACY_PATHS).map(([oldPath, to]) => (
              <Route key={oldPath} path={oldPath} element={<LegacyRedirect to={to} />} />
            ))}

            {/* Anything else: the server already served this URL as a 404;
                render a real page for the human instead of a blank layout. */}
            <Route path="*" element={<NotFound />} />

          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
