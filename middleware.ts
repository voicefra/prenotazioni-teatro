import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const basicAuth = req.headers.get('authorization');
    const expectedPassword = process.env.ADMIN_PASSWORD?.trim();

    if (basicAuth?.startsWith('Basic ')) {
      const authValue = basicAuth.split(' ')[1] ?? '';

      try {
        const decoded = atob(authValue);
        const separatorIndex = decoded.indexOf(':');

        if (separatorIndex !== -1) {
          const user = decoded.slice(0, separatorIndex);
          const pwd = decoded.slice(separatorIndex + 1).trim();

          // Log temporaneo per debug locale.
          console.log('Password ricevuta:', pwd);

          if (expectedPassword && user === 'admin' && pwd === expectedPassword) {
            return NextResponse.next();
          }
        }
      } catch (error) {
        console.log('Errore nel parsing Basic Auth:', error);
      }
    }

    return new NextResponse('Auth Required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
    });
  }

  return NextResponse.next();
}