self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        self.clients.claim()
    );
});


self.addEventListener("push", event => {

    let payload = {
        title: "JustAReminder",
        body: "Je hebt een herinnering.",
        url: "dashboard.html",
        tag: "justareminder"
    };

    if (event.data) {

        try {
            payload = event.data.json();
        } catch (error) {
            payload.body = event.data.text();
        }

    }


    const title =
        payload.title ||
        "JustAReminder";


    const options = {

        body:
            payload.body ||
            "Je hebt een herinnering.",

        tag:
            payload.tag ||
            "justareminder",

        renotify: true,

        timestamp:
            payload.timestamp
                ? Number(payload.timestamp)
                : Date.now(),

        data: {
            url:
                payload.url ||
                payload.data?.url ||
                "dashboard.html"
        }

    };


    event.waitUntil(
        self.registration.showNotification(
            title,
            options
        )
    );

});


self.addEventListener(
    "notificationclick",
    event => {

        event.notification.close();


        const page =
            event.notification.data?.url ||
            "dashboard.html";


        const targetUrl =
            new URL(
                page,
                self.registration.scope
            ).href;


        event.waitUntil(

            self.clients.matchAll({
                type: "window",
                includeUncontrolled: true
            })

            .then(clients => {

                for (const client of clients) {

                    if (
                        client.url.startsWith(
                            self.registration.scope
                        )
                    ) {

                        if ("navigate" in client) {
                            client.navigate(
                                targetUrl
                            );
                        }

                        return client.focus();

                    }

                }


                return self.clients.openWindow(
                    targetUrl
                );

            })

        );

    }
);
