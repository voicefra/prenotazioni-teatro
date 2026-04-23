import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  // Proteggiamo solo la rotta /admin
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const basicAuth = req.headers.get('authorization');
    const url = req.nextUrl;

    if (basicAuth) {
      const authValue = basicAuth.split(' ')[1];
      const [user, pwd] = atob(authValue).split(':');

      // Qui controlliamo la password (user può essere un nome a piacere, es 'admin')
      if (user === 'admin' && pwd === process.env.ADMIN_PASSWORD) {
        return NextResponse.next();
      }
    }

    // Se la password è sbagliata o manca, richiediamo l'autenticazione
    return new NextResponse('Auth Required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Secure Area"' },
    });
  }

  return NextResponse.next();
}