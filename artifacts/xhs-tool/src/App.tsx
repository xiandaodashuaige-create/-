import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser, useAuth } from "@clerk/react";
import { setTokenProvider } from "@/lib/auth";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout/Layout";
import Dashboard from "@/pages/dashboard";
import Accounts from "@/pages/accounts";
import ContentList from "@/pages/content/index";
import ContentEditor from "@/pages/content/editor";
import Assets from "@/pages/assets";
import Schedules from "@/pages/schedules";
import SensitiveWords from "@/pages/sensitive-words";
import Settings from "@/pages/settings";
import LandingPage from "@/pages/landing";
import WorkflowWizard from "@/pages/workflow/index";
import TrackingPage from "@/pages/tracking/index";
import TrackingDetail from "@/pages/tracking/detail";
import CompetitorsPage from "@/pages/competitors";
import MarketDataPage from "@/pages/market-data";
import AutopilotPage from "@/pages/autopilot";
import QuickPublishPage from "@/pages/quick-publish";
import AIGuide from "@/components/ai-guide/AIGuide";
import AdminPage from "@/pages/admin";
import OnboardingGuide from "@/components/onboarding/OnboardingGuide";
import { I18nProvider } from "@/lib/i18n";
import { PlatformProvider } from "@/lib/platform-context";
import { PlatformGuard } from "@/components/PlatformGuard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  variables: {
    colorPrimary: "#e74c3c",
    colorForeground: "#1a1a1a",
    colorMutedForeground: "#737373",
    colorDanger: "#dc2626",
    colorBackground: "#ffffff",
    colorInput: "#f5f5f5",
    colorInputForeground: "#1a1a1a",
    colorNeutral: "#e5e5e5",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-xl font-bold text-gray-900",
    headerSubtitle: "text-sm text-gray-500",
    socialButtonsBlockButtonText: "text-sm text-gray-700",
    formFieldLabel: "text-sm text-gray-700",
    footerActionLink: "text-red-500 hover:text-red-600",
    footerActionText: "text-sm text-gray-500",
    dividerText: "text-gray-400",
    identityPreviewEditButton: "text-red-500",
    formFieldSuccessText: "text-green-600",
    alertText: "text-sm",
    socialButtonsBlockButton: "border border-gray-200 hover:bg-gray-50",
    formButtonPrimary: "bg-red-500 hover:bg-red-600 text-white",
    formFieldInput: "border border-gray-200 bg-gray-50",
    footerAction: "justify-center",
    dividerLine: "bg-gray-200",
    otpCodeFieldInput: "border border-gray-200",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({
  component: Component,
  guard,
}: {
  component: React.ComponentType;
  guard?: "needs-auth" | "xhs-only";
}) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          {guard ? (
            <PlatformGuard mode={guard}>
              <Component />
            </PlatformGuard>
          ) : (
            <Component />
          )}
        </Layout>
        <AIGuide />
        <OnboardingGuide />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkTokenProvider() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenProvider(() => getToken());
  }, [getToken]);
  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <I18nProvider>
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "欢迎回来",
            subtitle: "登录鹿联AI爆款创作间",
          },
        },
        signUp: {
          start: {
            title: "创建账户",
            subtitle: "加入鹿联，开启AI爆款创作",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <PlatformProvider>
        <TooltipProvider>
          <ClerkTokenProvider />
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
            <Route path="/accounts">{() => <ProtectedRoute component={Accounts} />}</Route>
            <Route path="/workflow">{() => <ProtectedRoute component={WorkflowWizard} guard="xhs-only" />}</Route>
            <Route path="/autopilot">{() => <ProtectedRoute component={AutopilotPage} guard="needs-auth" />}</Route>
            <Route path="/quick-publish">{() => <ProtectedRoute component={QuickPublishPage} guard="needs-auth" />}</Route>
            <Route path="/competitors">{() => <ProtectedRoute component={CompetitorsPage} guard="needs-auth" />}</Route>
            <Route path="/market-data">{() => <ProtectedRoute component={MarketDataPage} guard="needs-auth" />}</Route>
            <Route path="/tracking">{() => <ProtectedRoute component={TrackingPage} guard="xhs-only" />}</Route>
            <Route path="/tracking/:id">{() => <ProtectedRoute component={TrackingDetail} guard="xhs-only" />}</Route>
            <Route path="/content">{() => <ProtectedRoute component={ContentList} />}</Route>
            <Route path="/content/new">{() => <ProtectedRoute component={ContentEditor} />}</Route>
            <Route path="/content/:id">{() => <ProtectedRoute component={ContentEditor} />}</Route>
            <Route path="/assets">{() => <ProtectedRoute component={Assets} />}</Route>
            <Route path="/schedules">{() => <ProtectedRoute component={Schedules} />}</Route>
            <Route path="/sensitive-words">{() => <ProtectedRoute component={SensitiveWords} guard="xhs-only" />}</Route>
            <Route path="/settings">{() => <ProtectedRoute component={Settings} />}</Route>
            <Route path="/admin">{() => <ProtectedRoute component={AdminPage} />}</Route>
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
        </PlatformProvider>
      </QueryClientProvider>
    </ClerkProvider>
    </I18nProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
