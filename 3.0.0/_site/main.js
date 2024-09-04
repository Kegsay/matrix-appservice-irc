window.addEventListener("load", () => {
    const scrollbox = document.querySelector(".sidebar-scrollbox");
    scrollbox.innerHTML = `<div class="version-box"><span>Version: </span></div>${scrollbox.innerHTML}`;
    const currentVersion = window.BRIDGE_VERSION || 'latest';

    const selectElement = document.createElement("select");
    
    fetch("https://api.github.com/repos/matrix-org/matrix-appservice-irc/releases", {
        cache: "force-cache",
    }).then(res => 
        res.json()
    ).then(releases => {
        selectElement.innerHTML = "";
        // N.B. We prefix with v
        for (const version of ['latest', ...releases.map(r => r.tag_name)]) {
            const option = document.createElement("option");
            option.innerHTML = version;
            selectElement.add(option);
            if (currentVersion === version) {
                option.setAttribute('selected', '');
            }
        }
    }).catch(ex => {
        console.error("Failed to fetch version data", ex);
    })
    
    const option = document.createElement("option");
    option.innerHTML = 'loading...';
    selectElement.add(option);

    selectElement.addEventListener('change', (event) => {
        const path = [
            ...window.location.pathname.split('/').slice(0, 2),
            event.target.value,
            ...window.location.pathname.split('/').slice(3),
        ].join('/');
        window.location = `${window.location.origin}${path}`;
    });

    document.querySelector(".version-box").appendChild(selectElement);
});