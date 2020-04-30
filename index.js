const AWS = require('aws-sdk/global');
const Route53 = require('aws-sdk/clients/route53');
const ECS = require('aws-sdk/clients/ecs');

AWS.config.update({
    region:'sa-east-1',
});

function main()
{
    const clusterARN = process.env.CLUSTER_ARN;
    const hostedZoneId = process.env.HOSTED_ZONE_ID;

    if(clusterARN == null || hostedZoneId == null)
    {
        console.error('Either CLUSTER_ARN or HOSTED_ZONE_ID environment variables are not set!');
        return Promise.reject();
    }

    return Promise.all([
        getTaskIPs(clusterARN),
        getRecordNameIpMap(hostedZoneId),
    ])
    .then(([taskIps, recordsMap]) =>
    {
        //Changes to be applied to Route53
        const changes = [];

        //Records whose IPs are not present in taskIps
        let invalidRecords = [];

        //IPs that don't have records associated with them
        //All IPs that have records will be removed from this
        //array in the next loop
        let orphanTaskIps = taskIps;

        for(const recordName in recordsMap)
        {
            const recordIp = recordsMap[recordName];

            //Remove record's IP from orphans array if it's in taskIps, since that
            //means the IP is not an orphan.
            if(taskIps.includes(recordIp))
            {
                orphanTaskIps = orphanTaskIps.filter(x => x != recordIp);
            }
            else
            {
                //If the record's IP is not in taskIps it means the record is invalid,
                //so we add it to the invalidRecords array
                invalidRecords.push(recordName);
            }
        }

        //Assign orphan IPs to invalid records
        for(const ip of orphanTaskIps)
        {
            if(invalidRecords.length > 0)
            {
                changes.push({
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                        Name: invalidRecords[0],
                        ResourceRecords: [ { Value: ip } ],
                        Type: 'A',
                        TTL: 300,
                    }
                });

                //Remove the first record from invalid records since it's not invalid anymore,
                //we just assigned a new IP to it
                invalidRecords = invalidRecords.slice(1);
            }
            else
            {
                //If there are no more invalid records there's nothing we can do.
                //The IP will stay an orphan.
                console.error(`Ran out of records! The following IP does not have a host name anymore: ${ip}`);
            }
        }

        const r53 = new Route53();

        if(changes.length > 0)
        {
            return r53.changeResourceRecordSets({
                ChangeBatch: {
                    Changes: changes,
                },
                HostedZoneId: hostedZoneId,
            }).promise();
        }
        else
        {
            return;
        }
    })
    .then(() =>
    {
        return { statusCode: 200 };
    });
}

/**
 * Returns an array containing private IPs from all FARGATE tasks in a cluster.
 * @param {String} clusterARN the ARN of the cluster of the tasks
 * @returns {String[]} an array of private IPs
 */
function getTaskIPs(clusterARN)
{
    const ecs = new ECS();

    return ecs.listTasks({
        cluster: clusterARN,
        launchType: 'FARGATE',
    }).promise()
    .then(response =>
    {
        return ecs.describeTasks({
            cluster: clusterARN,
            tasks: response.taskArns
        }).promise();
    })
    .then(response =>
    {
        const privateIps = [];
    
        for(const task of response.tasks)
        {
            const eni = task.attachments.find(x => x.type = 'ElasticNetworkInterface');
            const privateIp = eni.details.find(x => x.name == 'privateIPv4Address').value;
    
            privateIps.push(privateIp);
        }

        return privateIps;
    });
}


/**
 * Returns a map of recordName => IP from Route 53
 * @param {String} hostedZone the ID of the hosted zone from which to get the data
 * @returns {Object<string,string>} a recordName: IP map
 */
function getRecordNameIpMap(hostedZone)
{
    const r53 = new AWS.Route53();

    const map = {};

    return r53.listResourceRecordSets({
        HostedZoneId: hostedZone,
    }).promise()
    .then(response =>
    {
        for(const recordSet of response.ResourceRecordSets)
        {
            if(recordSet.Type != 'A')
            {
                continue;
            }

            if(recordSet.ResourceRecords.length > 1)
            {
                console.warn(`Record ${recordSet.Name} has more than one resource record. Ignoring it.`);
                continue;
            }

            const ip = recordSet.ResourceRecords[0].Value;

            map[recordSet.Name] = ip;
        }

        return map;
    });
}

exports.handler = main;