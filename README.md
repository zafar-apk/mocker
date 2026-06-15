# Mocker

Local response mocker for Android debug builds.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Android Debug Routing

For the Android emulator, route debug requests through:

```text
http://10.0.2.2:3000/proxy?url=<encoded original URL>
```

With OkHttp, keep production untouched and add this only in debug builds:

```kotlin
class MockerInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val proxyUrl = original.url.toString()

        val localUrl = "http://10.0.2.2:3000/proxy"
            .toHttpUrl()
            .newBuilder()
            .addQueryParameter("url", proxyUrl)
            .build()

        val request = original.newBuilder()
            .url(localUrl)
            .header("X-Mocker-Url", proxyUrl)
            .build()

        return chain.proceed(request)
    }
}
```

Matching rules are returned locally. Requests without a matching rule are forwarded to the original backend and returned unchanged.

## HTTPS Note

This approach works with HTTPS backends because the Android app intentionally sends the request to the local proxy, and the proxy performs the upstream HTTPS call. A transparent device-wide HTTPS proxy would require a trusted local CA certificate and MITM handling, which is a separate feature.
