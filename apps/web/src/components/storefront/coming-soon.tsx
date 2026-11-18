export function ComingSoon({
  storeName,
  email,
  phone,
}: {
  storeName: string;
  email: string;
  phone: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-16 text-stone-900">
      <div className="w-full max-w-xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-stone-400">
          {storeName}
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
          Coming soon
        </h1>
        <p className="mx-auto mt-5 max-w-md text-base leading-7 text-stone-600">
          We are putting the finishing touches on our store. Please check
          back soon.
        </p>

        {email || phone ? (
          <div className="mt-8 space-y-2 text-sm text-stone-600">
            <p className="font-medium text-stone-800">Questions?</p>
            {email ? (
              <p>
                <a
                  className="underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
                  href={`mailto:${email}`}
                >
                  {email}
                </a>
              </p>
            ) : null}
            {phone ? (
              <p>
                <a
                  className="underline decoration-stone-300 underline-offset-4 hover:text-stone-900"
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                >
                  {phone}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
