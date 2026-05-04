import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/content" component={ContentList} />
        <Route path="/content/new" component={ContentEditor} />
        <Route path="/content/:id" component={ContentEditor} />
        <Route path="/assets" component={Assets} />
        <Route path="/schedules" component={Schedules} />
        <Route path="/sensitive-words" component={SensitiveWords} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
