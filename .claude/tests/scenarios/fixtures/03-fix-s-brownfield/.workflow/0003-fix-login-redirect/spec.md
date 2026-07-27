# Spec: Fix login redirect loop

**ID**: 0003-fix-login-redirect
**Type**: fix
**Status**: approved
**Field**: brownfield

## Goal

Stop the admin login from looping back to the login page after a valid sign-in.

## Reproduction & Expected

**Reproduction**: sign in with valid admin credentials; the app returns to the login page instead of the dashboard.
**Expected**: a valid admin sign-in lands on the dashboard and stays there.

**Acceptance scenarios**

- [x] **AC1** — **Given** valid admin credentials, **When** the user signs in, **Then** they land on the dashboard and are not bounced back to login.

## Root cause hypothesis

The session cookie is written after the redirect decision reads it, so the guard sees no session and sends the user back to login.
