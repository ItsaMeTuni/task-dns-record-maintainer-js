# Task DNS Record Maintainer

This AWS Lambda function is used to maintain Route 53 DNS records updated every time a Fargate task is started. It will check all A records of the specified hosted zone and all tasks of the specified cluster. If a task does not have a record associated with its private IP and there is an existing A record whose IP does not correspond with any Fargate task, the _orphan_ task will be associated with the _invalid_ record. An orphan task is a task that does not have a host name that points to its private IP address in the hosted zone. An invalid record is a record that does not point to a Fargate task's private IP.

## Configuration

**Be sure to read all of this, everything in this section is important!**

The Task DNS Record Maintainer only needs the two following environment variables:

- `CLUSTER_ARN`: the ARN of the cluster of which the tasks should be monitored.
- `HOSTED_ZONE_ID`: the ID of the hosted zone with the records that should be maintained.

The function is triggered by a CloudWatch event from ECS that is triggered when a task is created.

Required permissions:
- List and Write resources in Route 53.
- List and Read resources in ECS.