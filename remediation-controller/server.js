const express = require('express');
const k8s = require('@kubernetes/client-node');

const app = express();
app.use(express.json());

const kc = new k8s.KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
} else {
    kc.loadFromDefault();
}

const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);

app.post('/heal', async (req, res) => {
    try {
        const data = req.body;
        console.log("Received Alertmanager Webhook:", JSON.stringify(data, null, 2));

        const alerts = data.alerts || [];
        for (const alert of alerts) {
            const status = alert.status;
            const labels = alert.labels || {};

            if (status === 'firing' && ['HighMemoryUsage', 'PodCrashLooping'].includes(labels.alertname)) {
                const namespace = labels.namespace || 'default';
                const deploymentName = labels.deployment || 'demo-app';

                console.log(`Triggering auto-remediation for deployment ${deploymentName} in namespace ${namespace}...`);

                const resDeployment = await k8sAppsApi.readNamespacedDeployment({
                    name: deploymentName,
                    namespace: namespace
                });
                
                const deployment = resDeployment;

                if (!deployment.spec.template.metadata) {
                    deployment.spec.template.metadata = {};
                }
                if (!deployment.spec.template.metadata.annotations) {
                    deployment.spec.template.metadata.annotations = {};
                }

                deployment.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();

                await k8sAppsApi.replaceNamespacedDeployment({
                    name: deploymentName,
                    namespace: namespace,
                    body: deployment
                });

                console.log(`Successfully restarted deployment: ${deploymentName}`);
            }
        }

        res.status(200).json({ status: 'success', message: 'Remediation evaluated' });
    } catch (error) {
        console.error("Failed to execute remediation:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Remediation controller running on port ${PORT}`);
});