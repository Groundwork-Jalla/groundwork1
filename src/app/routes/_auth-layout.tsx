import { Outlet } from "react-router";

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-off-white px-4">
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
