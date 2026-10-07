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
        tag: "justareminder",

        reminderId: null,
        reminderType: "reminder",
        repeatUntilCompleted: false
    };


    if (event.data) {

        try {

            payload = {
                ...payload,
                ...event.data.json()
            };

        } catch (error) {

            payload.body =
                event.data.text();

        }

    }


    const title =
        payload.title ||
        "JustAReminder";


    /*
     * Alleen taken die moeten blijven terugkomen
     * krijgen requireInteraction.
     */
    const isRepeatingTask =
        payload.reminderType === "task" &&
        payload.repeatUntilCompleted === true;


    const options = {

        body:
            payload.body ||
            "Je hebt een herinnering.",

        tag:
            payload.tag ||
            "justareminder",

        /*
         * Zorgt dat een nieuwe push met dezelfde tag
         * opnieuw aandacht vraagt.
         */
        renotify: true,


        /*
         * Bij een taak probeert de browser
         * de notificatie zichtbaar te houden
         * totdat de gebruiker ermee interacteert.
         */
        requireInteraction:
            isRepeatingTask,


        timestamp:
            payload.timestamp
                ? Number(payload.timestamp)
                : Date.now(),


        data: {

            url:
                payload.url ||
                payload.data?.url ||
                "dashboard.html",

            reminderId:
                payload.reminderId ||
                null,

            reminderType:
                payload.reminderType ||
                "reminder",

            repeatUntilCompleted:
                payload.repeatUntilCompleted === true
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
