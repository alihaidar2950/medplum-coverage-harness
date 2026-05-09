// Test fixture mirroring the shape of medplum's AppRoutes.tsx — nested
// routes, an index route, a Navigate redirect, and a top-level wrapper Route
// that only carries errorElement (no path/element of its own).
import type { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { SignInPage } from './SignInPage';
import { HomePage } from './HomePage';
import { ErrorPage } from './ErrorPage';
import { ProjectPage } from './admin/ProjectPage';
import { BotsPage } from './admin/BotsPage';
import { UsersPage } from './admin/UsersPage';
import { TimelinePage } from './resource/TimelinePage';
import { EditPage } from './resource/EditPage';

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route errorElement={<ErrorPage />}>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/admin" element={<ProjectPage />}>
          <Route path="bots" element={<BotsPage />} />
          <Route path="patients" element={<Navigate to="/admin/users" replace />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
        <Route path="/:resourceType/:id" element={<TimelinePage />}>
          <Route index element={<TimelinePage />} />
          <Route path="edit" element={<EditPage />} />
        </Route>
        <Route path="/" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
